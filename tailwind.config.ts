import type { Config } from 'tailwindcss';
import { heroui } from '@heroui/react';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0a0d0c',
          raised: '#0e1310',
        },
        silver: {
          DEFAULT: '#a9b3af',
          dim: '#6f7a76',
          bright: '#c7cfcc',
        },
        teal: {
          DEFAULT: '#2dd4bf',
          dim: '#1d8f82',
        },
        forest: {
          DEFAULT: '#3f7a56',
          bright: '#5aa87a',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'Inter', 'sans-serif'],
      },
    },
  },
  darkMode: 'class',
  plugins: [
    heroui({
      themes: {
        dark: {
          colors: {
            background: '#0a0d0c',
            foreground: '#dfe6e3',
            primary: {
              DEFAULT: '#2dd4bf',
              foreground: '#04211d',
            },
            success: {
              DEFAULT: '#3f7a56',
              foreground: '#eafff1',
            },
            default: {
              100: '#121613',
              200: '#171d19',
              300: '#232b26',
            },
          },
        },
      },
    }),
  ],
};

export default config;
