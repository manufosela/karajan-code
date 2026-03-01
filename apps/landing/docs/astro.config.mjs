// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	base: '/docs',
	integrations: [
		starlight({
			title: 'Karajan Code',
			logo: {
				src: './src/assets/logo.svg',
			},
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				es: { label: 'Español', lang: 'es' },
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/manufosela/karajan-code' },
			],
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					translations: { es: 'Primeros Pasos' },
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction', translations: { es: 'Introducción' } },
						{ label: 'Installation', slug: 'getting-started/installation', translations: { es: 'Instalación' } },
						{ label: 'Quick Start', slug: 'getting-started/quick-start', translations: { es: 'Inicio Rápido' } },
					],
				},
				{
					label: 'Guides',
					translations: { es: 'Guías' },
					items: [
						{ label: 'Pipeline', slug: 'guides/pipeline' },
						{ label: 'MCP Server', slug: 'guides/mcp-server', translations: { es: 'Servidor MCP' } },
						{ label: 'Plugin System', slug: 'guides/plugins', translations: { es: 'Sistema de Plugins' } },
						{ label: 'Configuration', slug: 'guides/configuration', translations: { es: 'Configuración' } },
					],
				},
				{
					label: 'Reference',
					translations: { es: 'Referencia' },
					items: [
						{ label: 'CLI Commands', slug: 'reference/cli', translations: { es: 'Comandos CLI' } },
						{ label: 'Configuration', slug: 'reference/configuration', translations: { es: 'Configuración' } },
						{ label: 'MCP Tools', slug: 'reference/mcp-tools', translations: { es: 'Herramientas MCP' } },
					],
				},
				{
					label: 'Architecture',
					translations: { es: 'Arquitectura' },
					items: [
						{ label: 'Overview', slug: 'architecture/overview', translations: { es: 'Visión General' } },
						{ label: 'History', slug: 'architecture/history', translations: { es: 'Historial' } },
					],
				},
				{
					label: 'Examples',
					translations: { es: 'Ejemplos' },
					autogenerate: { directory: 'examples' },
				},
				{
					label: 'FAQ',
					slug: 'faq',
				},
			],
		}),
	],
});
