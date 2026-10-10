export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#024927',
          'green-dark': '#01331b',
          'green-light': '#0a6b3b',
          'green-surface': '#f0fdf4',
          'green-border': '#bbf7d0',
        },
        surface: {
          canvas: '#f8fafc',
          card: '#ffffff',
          subtle: '#f1f5f9',
          border: '#e2e8f0',
        },
        content: {
          title: '#0f172a',
          body: '#334155',
          muted: '#64748b',
          subtle: '#94a3b8',
        },
      },
      borderRadius: {
        'card': '18px',
      },
      boxShadow: {
        'resting': '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
        'hover': '0 4px 12px -2px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04)',
        'raised': '0 12px 24px -4px rgba(0, 0, 0, 0.08), 0 4px 8px -2px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
}