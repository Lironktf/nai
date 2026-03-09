/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#FFFFFF',
        ink: '#0A0A0A',
        navy: '#1A3A5C',
        success: '#22C55E',
        muted: '#6B7280',
        surface: '#F5F5F5',
        border: '#E5E7EB',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
