/** Locale namespace owned by this plugin's status section. */
export const NS = 'dshAntigravity'

/** Chinese dictionary; the key set is the source of truth. */
export const zh = {
  title: 'Antigravity',
  refresh: '刷新',
  checking: '读取中…',
  signedIn: '已登录',
  signedOut: '未登录',
  unavailable: '不可用',
  signedOutHint: '在终端运行 agy 完成 Google 登录后，这里会显示用量限额。',
  missingHint: '没有找到 agy。安装 Antigravity CLI，或用 AGY_BIN 指定可执行文件路径。',
  failedHint: '读取失败，稍后重试。',
  quotaUnavailable: '已登录，但这次没有读到限额数据。',
  credits: 'G1 额度',
  remaining: '剩余',
  resetAt: '重置',
  checkedAt: '更新于',
  modelsTitle: '模型',
  modelsHint: '勾选允许委派使用的模型；一个都不勾时全部可用。默认模型用于配置没有固定 model 时的委派。',
  modelsDefault: '默认',
  modelsAvailable: '已选',
  modelsAllAvailable: '全部可用',
  modelsCount: '个模型',
  modelsEmpty: '读取不到模型列表，确认 agy 已登录。',
  modelsSaving: '保存中…',
  modelsFailed: '读取模型设置失败。',
} satisfies Record<string, string>

/** Every key the panel translates. */
export type AntigravityKey = keyof typeof zh

/** English dictionary; completeness is checked against {@link AntigravityKey}. */
export const en: Record<AntigravityKey, string> = {
  title: 'Antigravity',
  refresh: 'Refresh',
  checking: 'Reading…',
  signedIn: 'Signed in',
  signedOut: 'Signed out',
  unavailable: 'Unavailable',
  signedOutHint: 'Run agy in a terminal to finish Google sign-in; quotas appear here afterwards.',
  missingHint: 'agy was not found. Install the Antigravity CLI or point AGY_BIN at the executable.',
  failedHint: 'Could not read the account. Try again shortly.',
  quotaUnavailable: 'Signed in, but no quota rows came back this time.',
  credits: 'G1 credits',
  remaining: 'remaining',
  resetAt: 'resets',
  checkedAt: 'Updated',
  modelsTitle: 'Models',
  modelsHint: 'Checked models may be used for delegation; with none checked every model is available. The default model applies when the deployment config does not pin one.',
  modelsDefault: 'Default',
  modelsAvailable: 'selected',
  modelsAllAvailable: 'all available',
  modelsCount: 'models',
  modelsEmpty: 'No model list came back. Check that agy is signed in.',
  modelsSaving: 'Saving…',
  modelsFailed: 'Could not read the model settings.',
}
