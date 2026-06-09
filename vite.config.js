import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace 'your-repo-name' with your actual GitHub repository name.
// If you're deploying to a custom domain or username.github.io root,
// set base to '/' instead.
export default defineConfig({
  plugins: [react()],
  base: '/classroom-allocation/',
})
