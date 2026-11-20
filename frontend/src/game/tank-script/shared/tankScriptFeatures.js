// Vite defines this only for an explicitly opted-in development server.
export const JAVA_DEBUGGER_ENABLED = typeof __TANKSCRIPT_EXPERIMENTAL_JAVA__ !== 'undefined'
  && __TANKSCRIPT_EXPERIMENTAL_JAVA__ === true;

export const MAX_JAVA_BATTLE_TANKS = 4;
