/// <reference types="vite/client" />

declare module '*.csv?raw' {
  const text: string
  export default text
}
