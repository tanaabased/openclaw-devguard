export default function notImplemented(command: string): never {
  const error = new Error(
    `openclaw devguard ${command} is not implemented in this structural scaffold.`,
  );
  error.name = 'DevguardNotImplementedError';
  throw error;
}
