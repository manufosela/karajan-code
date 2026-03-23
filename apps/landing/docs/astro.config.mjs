// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
// https://astro.build/config
export default defineConfig({
	base: '/docs',
	integrations: [
		starlight({
			title: 'Karajan Code',
			head: [
				{
					tag: 'link',
					attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
				},
				{
					tag: 'link',
					attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
				},
				{
					tag: 'link',
					attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap' },
				},
				{
					tag: 'script',
					content: `document.addEventListener('DOMContentLoaded',()=>{const a=document.querySelector('.site-title');if(a)a.href='/';const f=document.querySelector('footer.sl-flex');if(f){const p=document.createElement('p');p.style.cssText='margin-top:1rem;text-align:center;';p.innerHTML='<a href="https://librecounter.org/referer/show" target="_blank"><img src="https://librecounter.org/outline.svg" referrerPolicy="unsafe-url" alt="LibreCounter" /></a>';f.appendChild(p);}});`,
				},
			],
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
						{ label: 'Pipeline Flows', slug: 'guides/flows', translations: { es: 'Flujos del Pipeline' } },
						{ label: 'MCP Server', slug: 'guides/mcp-server', translations: { es: 'Servidor MCP' } },
						{ label: 'Skills Mode', slug: 'guides/skills', translations: { es: 'Modo Skills' } },
						{ label: 'Plugin System', slug: 'guides/plugins', translations: { es: 'Sistema de Plugins' } },
						{ label: 'Configuration', slug: 'guides/configuration', translations: { es: 'Configuración' } },
						{ label: 'HU Board', slug: 'guides/hu-board', translations: { es: 'HU Board' } },
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
					label: 'Contributors',
					slug: 'contributors',
				},
				{
					label: 'FAQ',
					slug: 'faq',
				},
			],
		}),
	],
});
