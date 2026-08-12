const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redactCredentials } = require('./redaction');
const { readRawApiCall } = require('./raw-api-capture');

const MANIFEST_TEMPLATE = Object.freeze({
  task_id: '',
  track: '3d',
  req_type: '',
  scene: '',
  level: '',
  tech: [],
  rounds: 0,
  ai_model: '',
  has_ref_image: false,
  run_entry: '',
  repo_cmd: '',
  author: '',
  qc_by: '',
  created_at: '',
});

function validateFolderName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..') throw new Error('标注目录名称不能为空');
  if (/[<>:"/\\|?*\x00-\x1F]/.test(name) || /[. ]$/.test(name)) throw new Error('标注目录名称包含无效字符');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('标注目录名称是系统保留名称');
  return name;
}

function timestampBase(value, fallbackIndex) {
  const parsed = new Date(value || '');
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().replace(/[-:.]/g, '');
  return `unknown_${String(fallbackIndex + 1).padStart(4, '0')}`;
}

function readInterceptRecords(sessionDir) {
  const file = path.join(sessionDir, 'https-intercepts.json');
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`抓包文件无法解析: ${error.message}`);
  }
  if (!Array.isArray(parsed?.data)) throw new Error('抓包文件缺少 data 数组');
  return parsed.data;
}

function applyRecordingWindow(sessionDir, records) {
  const configFile = path.join(sessionDir, 'config.json');
  if (!fs.existsSync(configFile)) return records;
  let config;
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return records; }
  const recording = config.recording || config.capture;
  if (!recording?.startedAt && !recording?.officialStartedAt) return records;
  const startId = Number(recording.startInterceptId || 0);
  const endId = recording.endInterceptId === null || recording.endInterceptId === undefined
    ? Infinity : Number(recording.endInterceptId);
  return records.filter((record) => Number(record?.id || 0) > startId && Number(record?.id || 0) <= endId);
}

function isAnthropicModelCall(record) {
  if (String(record?.method || '').toUpperCase() !== 'POST') return false;
  const requestPath = String(record?.path || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  if (!requestPath.endsWith('/v1/messages')) return false;
  const body = record?.request?.body;
  return Boolean(body
    && typeof body === 'object'
    && !Array.isArray(body)
    && String(body.model || '').trim()
    && Array.isArray(body.messages));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createSkeleton(root) {
  const directories = [
    'task/assets',
    'trajectory',
    'screenshots',
    'workspace/src',
    'workspace/dist',
    'env',
    'qc',
  ];
  for (const relative of directories) fs.mkdirSync(path.join(root, relative), { recursive: true });

  writeJson(path.join(root, 'manifest.json'), MANIFEST_TEMPLATE);
  fs.writeFileSync(path.join(root, 'task', 'prompt.md'), '');
  writeJson(path.join(root, 'env', 'env_snapshot.json'), {});
  fs.writeFileSync(path.join(root, 'env', 'build.md'), '');
  fs.writeFileSync(path.join(root, 'qc', 'self_check.md'), '');
  writeJson(path.join(root, 'qc', 'qc_report.json'), {});
}

function attachRawTrajectory(sessionDir, record) {
  const metadata = record?.response?.rawCapture;
  if (!metadata) return { record, raw: false, complete: record?.response?.captureComplete !== false, signature: Boolean(record?.response?.parsed?.signature) };
  const output = JSON.parse(JSON.stringify(record));
  if (!metadata.file) {
    output.rawTrajectory = { ...metadata, events: [], parseErrors: [], complete: false };
    return { record: output, raw: false, complete: false, signature: false };
  }
  try {
    const parsed = readRawApiCall(sessionDir, metadata.file);
    output.rawTrajectory = {
      version: metadata.version || 1,
      source: metadata.file,
      complete: metadata.complete !== false
        && parsed.errors.length === 0
        && !(record?.response?.streaming && (metadata.eventCount ?? 0) === 0),
      error: metadata.error
        || (record?.response?.streaming && (metadata.eventCount ?? 0) === 0 ? 'SSE 响应未包含有效 data 事件' : ''),
      contentEncoding: metadata.contentEncoding || record?.response?.contentEncoding || record?.response?.headers?.['content-encoding'] || '',
      decoded: metadata.decoded ?? record?.response?.decoded ?? false,
      eventCount: metadata.eventCount ?? parsed.events.filter((event) => event.type === 'sse').length,
      signatureDeltaCount: metadata.signatureDeltaCount ?? 0,
      thinkingDeltaCount: metadata.thinkingDeltaCount ?? 0,
      bodyChunkCount: metadata.bodyChunkCount ?? 0,
      messageStartCount: metadata.messageStartCount ?? 0,
      messageStopCount: metadata.messageStopCount ?? 0,
      parseErrors: parsed.errors,
      events: parsed.events,
    };
    return {
      record: output,
      raw: true,
      complete: output.rawTrajectory.complete,
      signature: output.rawTrajectory.signatureDeltaCount > 0 || Boolean(record?.response?.parsed?.signature),
    };
  } catch (error) {
    output.rawTrajectory = {
      version: metadata.version || 1,
      source: metadata.file,
      complete: false,
      eventCount: 0,
      signatureDeltaCount: 0,
      thinkingDeltaCount: 0,
      parseErrors: [{ message: error.message }],
      events: [],
    };
    return { record: output, raw: false, complete: false, signature: false };
  }
}

function writeTrajectory(root, sessionDir, records) {
  const trajectoryDir = path.join(root, 'trajectory');
  const seen = new Map();
  const files = [];
  const summary = { total: records.length, rawCaptured: 0, complete: 0, incomplete: 0, incompleteCallIds: [], withSignature: 0 };
  records.forEach((record, index) => {
    const base = timestampBase(record?.timestamp, index);
    const occurrence = seen.get(base) || 0;
    seen.set(base, occurrence + 1);
    const suffix = occurrence ? `_${String(occurrence + 1).padStart(3, '0')}` : '';
    const filename = `${base}${suffix}_apicall.json`;
    const hydrated = attachRawTrajectory(sessionDir, record);
    if (hydrated.raw) summary.rawCaptured++;
    if (hydrated.complete) summary.complete++;
    else {
      summary.incomplete++;
      summary.incompleteCallIds.push(record?.id ?? index);
    }
    if (hydrated.signature) summary.withSignature++;
    writeJson(path.join(trajectoryDir, filename), redactCredentials(hydrated.record));
    files.push(filename);
  });
  return { files, summary };
}

function exportAnnotationDirectory({ sessionDir, outputRoot, folderName }) {
  const source = path.resolve(sessionDir);
  const root = path.resolve(outputRoot);
  const name = validateFolderName(folderName);
  const target = path.join(root, name);
  if (target === source || target.startsWith(`${source}${path.sep}`)) throw new Error('标注目录不能创建在当前 Session 内');
  if (fs.existsSync(target)) throw new Error(`目标目录已存在: ${target}`);

  fs.mkdirSync(root, { recursive: true });
  const temporary = path.join(root, `.${name}.tmp-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(temporary);
    createSkeleton(temporary);
    const records = applyRecordingWindow(source, readInterceptRecords(source))
      .filter(isAnthropicModelCall)
      .sort((a, b) => String(a?.timestamp || '').localeCompare(String(b?.timestamp || '')) || Number(a?.id || 0) - Number(b?.id || 0));
    const trajectory = writeTrajectory(temporary, source, records);
    fs.renameSync(temporary, target);
    return { path: target, folderName: name, trajectoryFiles: trajectory.files, trajectorySummary: trajectory.summary };
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  MANIFEST_TEMPLATE,
  applyRecordingWindow,
  attachRawTrajectory,
  exportAnnotationDirectory,
  isAnthropicModelCall,
  readInterceptRecords,
  validateFolderName,
};
