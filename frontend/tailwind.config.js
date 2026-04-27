/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#0B7C6E',
        'primary-foreground': '#ffffff',
        secondary: 'hsl(210 40% 96%)',
        'secondary-foreground': 'hsl(222 47% 11%)',
        muted: 'hsl(210 40% 98%)',
        'muted-foreground': 'hsl(215 16% 47%)',
        accent: 'hsl(166 76% 97%)',
        'accent-foreground': 'hsl(222 47% 11%)',
        border: 'hsl(214 32% 91%)',
        background: '#ffffff',
        foreground: 'hsl(222 47% 11%)',
      },
      fontFamily: {
        heading: ['Syne', 'sans-serif'],
        sans: ['Instrument Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
