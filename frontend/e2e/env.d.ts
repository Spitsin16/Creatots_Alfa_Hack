// Автотесту из Node нужны только переменные окружения — без пакета @types/node.
declare const process: { env: Record<string, string | undefined> }
