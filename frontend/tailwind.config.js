/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        crunch: { yellow: '#ffd928', red: '#d93b2b', orange: '#f4782e', ink: '#241d16', cream: '#fff8da' },
      },
      boxShadow: { pop: '0 10px 0 rgba(78, 45, 20, .16)' },
    },
  },
  plugins: [],
}

