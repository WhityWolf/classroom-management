import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE is injected by the GitHub Actions workflow.
// - main branch  →  /your-repo-name/
// - dev branch   →  /your-repo-name/dev/
// Fallback to '/your-repo-name/' for local `npm run build`.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/classroom-management/',
})