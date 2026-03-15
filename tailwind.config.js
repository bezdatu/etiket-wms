/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        background: '#0f172a',
        surface: '#1e293b',
        text: '#f8fafc',
        muted: '#94a3b8'
      }
    },
  },
  plugins: [],
}
