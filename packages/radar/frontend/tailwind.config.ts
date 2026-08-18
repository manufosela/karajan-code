import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        /* Core radar theme */
        radar: {
          50: "#eef7ff",
          100: "#d9edff",
          200: "#bce0ff",
          300: "#8ecdff",
          400: "#59b0ff",
          500: "#338bff",
          600: "#1b6af5",
          700: "#1454e1",
          800: "#1744b6",
          900: "#193c8f",
          950: "#0f2354",
        },
        /* Dark blue base */
        navy: {
          50: "#f0f4fd",
          100: "#e3eafb",
          200: "#ccd8f7",
          300: "#a9bdf0",
          400: "#809ae7",
          500: "#6278de",
          600: "#4d5bd1",
          700: "#424bc0",
          800: "#3b409c",
          900: "#343a7c",
          950: "#1e2148",
        },
        /* Teal accent */
        teal: {
          50: "#effefb",
          100: "#c8fff4",
          200: "#91feea",
          300: "#53f5dc",
          400: "#20e2ca",
          500: "#07c6b1",
          600: "#03a092",
          700: "#077f76",
          800: "#0b6460",
          900: "#0e534f",
          950: "#003332",
        },
        /* Warm accent */
        amber: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
          950: "#451a03",
        },
        /* Strategic bucket colors */
        bucket: {
          adopt: "#10b981",
          trial: "#3b82f6",
          assess: "#f59e0b",
          hold: "#6b7280",
          monitor: "#8b5cf6",
          innovate: "#ec4899",
        },
        /* Status colors */
        status: {
          relevant: "#10b981",
          review: "#f59e0b",
          discarded: "#6b7280",
          opportunity: "#3b82f6",
          follow_up: "#f97316",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "-apple-system", "sans-serif"],
        serif: ["var(--font-source-serif)", "Georgia", "serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "none",
            color: "var(--tw-prose-body)",
            a: {
              color: "var(--tw-prose-links)",
              textDecoration: "underline",
              fontWeight: "500",
            },
          },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
