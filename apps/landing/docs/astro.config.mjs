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
					content: `document.addEventListener('DOMContentLoaded',()=>{const a=document.querySelector('.site-title');if(a)a.href='/';var o=new MutationObserver(function(){var t=document.documentElement.dataset.theme;if(t){localStorage.setItem('theme',t);localStorage.setItem('starlight-theme',t);}});o.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});});`,
				},
				{
					tag: 'script',
					attrs: { defer: true, src: 'https://analytics.manulitics.com/script.js', 'data-website-id': '8871eadf-4414-4baf-b83a-9f3da27b97fe' },
				},
			],
			logo: {
				src: './src/assets/karajan-orbit.svg',
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
					label: 'Karajan v4',
					translations: { es: 'Karajan v4' },
					items: [
						{ label: 'Install', slug: 'v4/install', translations: { es: 'Instalación' } },
						{ label: 'Work with your agent', slug: 'v4/working-with-your-agent', translations: { es: 'Trabaja con tu agente' } },
						{ label: 'The gates', slug: 'v4/gates', translations: { es: 'Los gates' } },
						{ label: 'Command reference', slug: 'v4/commands', translations: { es: 'Referencia de comandos' } },
						{ label: 'Headless mode', slug: 'v4/headless', translations: { es: 'Modo headless' } },
					],
				},
				{
					label: 'v3 (legacy)',
					translations: { es: 'v3 (legacy)' },
					collapsed: true,
					items: [
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
						{ label: 'Hardening Against AI', slug: 'guides/hardening-against-ai', translations: { es: 'Blindar frente a IA' } },
						{ label: 'Recommended Setup', slug: 'guides/recommended-setup', translations: { es: 'Configuración Recomendada' } },
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
					label: 'Handbook',
					translations: { es: 'Manual' },
					collapsed: true,
					autogenerate: { directory: 'handbook' },
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
				},
			],
		}),
	],
});
