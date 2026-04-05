/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0f1117",
        surface: "#1a1d27",
        border: "#2a2d3a",
        accent: "#6c63ff",
        "accent-hover": "#574fd6",
        muted: "#8b8fa8",
      },
    },
  },
  plugins: [],
}

