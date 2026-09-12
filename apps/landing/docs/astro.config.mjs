// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightSidebarTopics from 'starlight-sidebar-topics';
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
					content: `document.addEventListener('DOMContentLoaded',()=>{const a=document.querySelector('.site-title');if(a)a.href='/';var o=new MutationObserver(function(){var t=document.documentElement.dataset.theme;if(t){try{localStorage.setItem('theme',t);localStorage.setItem('starlight-theme',t);}catch(e){}}});o.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});});`,
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
			plugins: [
				starlightSidebarTopics([
					{
						label: 'Karajan v4',
						link: '/v4/install/',
						icon: 'rocket',
						items: [
							{
								label: 'Start here', translations: { es: 'Empieza aquí' },
								items: [
									{ label: 'Install', slug: 'v4/install', translations: { es: 'Instalación' } },
									{ label: 'Work with your agent', slug: 'v4/working-with-your-agent', translations: { es: 'Trabaja con tu agente' } },
								],
							},
							{
								label: 'The method', translations: { es: 'El método' },
								items: [
									{ label: 'The gates', slug: 'v4/gates', translations: { es: 'Los gates' } },
									{ label: 'The Sentinel', slug: 'guides/sentinel', translations: { es: 'El Sentinel' } },
									{ label: 'Hardening against AI', slug: 'guides/hardening-against-ai', translations: { es: 'Blindar frente a IA' } },
									{ label: 'The HU-Board', slug: 'guides/hu-board', translations: { es: 'El HU-Board' } },
								],
							},
							{
								label: 'Try it', translations: { es: 'Pruébalo' },
								items: [
									{ label: 'Recommended setup', slug: 'guides/recommended-setup', translations: { es: 'Configuración recomendada' } },
									{ label: 'Pipeline flows', slug: 'guides/flows', translations: { es: 'Flujos del pipeline' } },
								],
							},
							{
								label: 'Reference', translations: { es: 'Referencia' },
								items: [
									{ label: 'Command reference', slug: 'v4/commands', translations: { es: 'Referencia de comandos' } },
									{ label: 'Headless mode', slug: 'v4/headless', translations: { es: 'Modo headless' } },
									{ label: 'MCP server', slug: 'guides/mcp-server', translations: { es: 'Servidor MCP' } },
									{ label: 'Contributors', slug: 'contributors' },
								],
							},
						],
					},
					{
						label: 'kaRAGan (RAG)',
						link: '/karagan/',
						icon: 'seti:db',
						items: [
							{ label: 'Overview', slug: 'karagan', translations: { es: 'Visión general' } },
							{ label: 'RAG in 5 minutes', slug: 'karagan/quickstart', translations: { es: 'RAG en 5 minutos' } },
							{ label: 'Context strategies', slug: 'karagan/context-strategies', translations: { es: 'Estrategias de contexto' } },
							{ label: 'Serve and configure', slug: 'karagan/serve', translations: { es: 'Servir y personalizar' } },
							{ label: 'Sensitivity and privacy', slug: 'karagan/sensitivity', translations: { es: 'Sensibilidad y privacidad' } },
							{ label: 'Container and GCP', slug: 'karagan/deploy', translations: { es: 'Contenedor y GCP' } },
							{ label: 'Embeddable SDK', slug: 'karagan/sdk', translations: { es: 'SDK embebible' } },
						],
					},
					{
						label: 'Watch',
						link: '/watch/',
						icon: 'magnifier',
						items: [
							{ label: 'Overview', slug: 'watch', translations: { es: 'Visión general' } },
							{ label: 'Design and phases', slug: 'watch/design', translations: { es: 'Diseño y fases' } },
							{ label: 'Configuration', slug: 'watch/config', translations: { es: 'Configuración' } },
							{ label: 'Ingestion on merge', slug: 'watch/ingest', translations: { es: 'Ingesta por merge' } },
							{ label: 'Cross-repo impact', slug: 'watch/impact', translations: { es: 'Impacto cross-repo' } },
							{ label: 'Documentation drift', slug: 'watch/drift', translations: { es: 'Deriva de documentación' } },
							{ label: 'Eval and calibration', slug: 'watch/eval', translations: { es: 'Eval y calibración' } },
							{ label: 'Contract with the engine', slug: 'watch/engine-contract', translations: { es: 'Contrato con el motor' } },
						],
					},
					{
						label: { en: 'v3 — historical archive', es: 'v3 — archivo histórico' },
						link: '/getting-started/introduction/',
						icon: 'seti:folder',
						badge: { text: 'V3', variant: 'caution' },
						items: [
							{
								label: 'v3 archive', translations: { es: 'Archivo v3' },
								collapsed: true,
								items: [
									{ label: 'Introduction', slug: 'getting-started/introduction', translations: { es: 'Introducción' } },
									{ label: 'Installation', slug: 'getting-started/installation', translations: { es: 'Instalación' } },
									{ label: 'Quick Start', slug: 'getting-started/quick-start', translations: { es: 'Inicio Rápido' } },
									{ label: 'Pipeline', slug: 'guides/pipeline' },
									{ label: 'Skills Mode', slug: 'guides/skills', translations: { es: 'Modo Skills' } },
									{ label: 'Plugin System', slug: 'guides/plugins', translations: { es: 'Sistema de Plugins' } },
									{ label: 'Configuration', slug: 'guides/configuration', translations: { es: 'Configuración' } },
									{ label: 'Troubleshooting', slug: 'guides/troubleshooting', translations: { es: 'Resolución de problemas' } },
									{ label: 'CLI Commands', slug: 'reference/cli', translations: { es: 'Comandos CLI' } },
									{ label: 'Reference: Configuration', slug: 'reference/configuration', translations: { es: 'Referencia: Configuración' } },
									{ label: 'MCP Tools', slug: 'reference/mcp-tools', translations: { es: 'Herramientas MCP' } },
									{ label: 'Architecture overview', slug: 'architecture/overview', translations: { es: 'Arquitectura: visión general' } },
									{ label: 'Architecture history', slug: 'architecture/history', translations: { es: 'Historial de arquitectura' } },
									{ label: 'v3 feature tour', slug: 'architecture/feature-tour', translations: { es: 'Recorrido de features v3' } },
									{ label: 'FAQ', slug: 'faq' },
								],
							},
							{ label: 'Handbook', translations: { es: 'Manual' }, collapsed: true, autogenerate: { directory: 'handbook' } },
							{ label: 'Examples', translations: { es: 'Ejemplos' }, collapsed: true, autogenerate: { directory: 'examples' } },
						],
					},
				]),
			],
		}),
	],
});
