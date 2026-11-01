export type Frame = number

declare module 'claude-code' {
  interface PluginState {
    'spin-mascot': { frame: Frame }
  }
}
