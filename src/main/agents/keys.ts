/**
 * settings 表中保存「用户自定义 Agent 来源路径」的键名。
 *
 * 单独抽出来是因为扫描器、监控器和 IPC 都要用同一套键：
 * 自动扫描必须读取用户在设置页填写的路径，否则用户配置形同虚设。
 */
export const AGENT_SOURCE_KEY = (agentId: string): string => `agent.source.${agentId}`
