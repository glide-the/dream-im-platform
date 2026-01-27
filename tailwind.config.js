/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./app/components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--color-bg-primary)",
          secondary: "var(--color-bg-secondary)",
          surface: "var(--color-surface)"
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          light: "var(--color-accent-light)"
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)"
        },
        border: {
          DEFAULT: "var(--color-border)"
        }
      },
      boxShadow: {
        subtle: "0 4px 20px #0F172A0A",
        medium: "0 10px 30px #0F172A0A",
        accent: "0 8px 20px #2F6FED40"
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-serif", "Georgia"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"]
      }
    }
  },
  plugins: []
};
