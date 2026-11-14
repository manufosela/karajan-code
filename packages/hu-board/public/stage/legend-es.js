// KJC-TSK-1626 (asked by the maintainer on 2026-11-14): the cast legend in English and Spanish.
// legend.js holds the English cards; here, their Spanish, card by card and mark by mark in the
// same order. Pure: legend-panel.js asks for the cards in the language picked.
import { CARDS, KINDS } from './legend.js';

export const LANGS = ['en', 'es'];

const KINDS_ES = { agent: 'Agente', crew: 'Tripulación', piece: 'Pieza del método', tool: 'Herramienta', thing: 'En la nave' };
const LABELS = {
  en: { title: 'The cast', close: 'Close', does: 'Does', when: 'Comes out', calledBy: 'Called by', marks: 'Its marks' },
  es: { title: 'El reparto', close: 'Cerrar', does: 'Qué hace', when: 'Cuándo sale', calledBy: 'Quién lo llama', marks: 'Sus marcas' },
};

const COLOUR = ['Color del cuerpo', 'Su IA: Claude naranja, Codex lila, agy menta; cualquier otra, gris.'];
const BACKPACK = ['Mochila', 'Del color de la persona para la que trabaja y con su emblema: todos los robots de una persona llevan la misma.'];

/** id: [name, does, when, calledBy, [[mark, means], …]] */
const ES = {
  host: ['Anfitrión', 'Tu propia sesión de IA (Claude Code y similares): trabaja el carril y llama a los demás.', 'Mientras tu sesión trabaja en ese carril; sale por la puerta cuando la sesión acaba.', 'Tú, al abrir una sesión. Antes de una card va al atril a por sus skills.', [
    ['Tamaño', 'Más grande que todos los demás.'], COLOUR, ['Holograma sobre la cabeza', 'Tu emblema (o tu inicial), girando despacio: de quién es el anfitrión.'],
    ['Placa del pecho', 'Tu emblema otra vez, en tu color.'], BACKPACK, ['Rótulo', 'El login de su dueño. «waits for you» en ámbar, «waits for a process» en azul.']]],
  teammate: ['Anfitrión de un compañero', 'El anfitrión de otra persona del mismo repositorio, en directo desde su board.', 'Mientras su sesión trabaja; está en el carril de su card.', 'Tu compañero. Su board solo comparte rol, carril, card, modelo y avatar.', [
    ['Mochila y holograma', 'En su color y con su emblema, nunca los tuyos.'], ['Rótulo', 'Su login de GitHub.']]],
  coder: ['Coder', 'Escribe el código de una card con contexto limpio y el modelo que pide su nivel.', 'Brota de Karajan, va a su mesa y vuelve a fundirse en Karajan al terminar.', 'Karajan, cuando el anfitrión lanza kj code (o kj run).', [
    COLOUR, BACKPACK, ['Portátil', 'Abierto y encendido en el color de su IA mientras teclea.']]],
  solomon: ['Solomon', 'Arbitra: una tercera IA decide cuando el coder y el revisor no se ponen de acuerdo.', 'Solo cuando las iteraciones de revisión acaban sin acuerdo; se va cuando dictamina.', 'Karajan (kj solomon), nunca el coder ni el revisor.', [
    ['Túnica y corona', 'El rey Salomón, el juez.'], COLOUR, BACKPACK]],
  subagent: ['Subagente', 'Un ayudante que el anfitrión abre para un encargo: una búsqueda, una revisión, un plan.', 'Brota de su anfitrión y forma en filas delante de la mesa hasta acabar el encargo.', 'El anfitrión, con su herramienta Agent.', [
    ['Tamaño', 'Pequeño: trabaja para el anfitrión.'], BACKPACK]],
  wardrobe: ['Lo que lleva un agente', 'Dice de un vistazo con qué modelo y esfuerzo trabaja un agente.', 'En todo agente cuyo modelo conoce el board.', 'El modelo y el esfuerzo con que se lanzó.', [
    ['Birrete', 'Fable.'], ['Gafas redondas', 'Opus.'], ['Auriculares (la banda oscura sobre la cabeza)', 'Sonnet.'], ['Gorra', 'Haiku.'],
    ['Complexión', 'Su esfuerzo: fuerte en high o más, tal cual en medium, delgado en low.']]],
  conductor: ['Karajan', 'Dirige el método: lanza a los agentes y reacciona a lo que decide el método.', 'Siempre, al final de la fila de puestos.', 'Un veredicto de revisión, un commit en las puertas o un sello del Ledger lo giran hacia ese carril.', [
    ['Verde, con batuta', 'Agita la batuta cuando el trabajo pasa y levanta la mano cuando no.']]],
  rag: ['kaRAGan', 'La memoria: responde preguntas sobre el código desde el índice del proyecto.', 'Lleva la respuesta al carril que preguntó; durante una reindexación teclea allí.', 'kj rag query y kj rag index.', [['Ámbar', 'Su color, también el de su portátil.']]],
  watch: ['kaWATCHan', 'El vigilante de los repositorios y guardián del contador de versión.', 'Tras una release va al contador y pone la versión nueva.', 'Una release.', [['Azul', 'Su color.']]],
  courier: ['Mensajero', 'Lleva una card entre el tablero y su carril, con la card sobre la cabeza.', 'Cuando una card se crea, empieza o termina; se va al acabar el recado.', 'El board, según se mueve la card.', []],
  tdd: ['TDD', 'Primero el test que falla, y la suite nunca en rojo.', 'En su puesto; se enciende cuando se juzga una pasada de tests.', 'El método, en cada cambio.', []],
  sentinel: ['Sentinel', 'Revisa cada llamada a herramienta del anfitrión contra el método y para las que lo rompen.', 'En su puesto elevado, mirando al carril que revisa; su luz parpadea en cada llamada que deja pasar.', 'Cada llamada a herramienta. Si deniega, baja junto a ese agente, se queda un momento y vuelve a subir.', []],
  review: ['Revisión IA', 'Otra IA revisa el diff exacto; su veredicto queda atado a él.', 'Se pone al lado del coder mientras revisa. Con varias revisiones a la vez, un fantasma transparente guarda su puesto.', 'kj review, antes de cada commit.', [['Sin robot', 'El revisor es esta pieza, no un agente en una mesa.']]],
  gates: ['Puertas git', 'Solo dejan entrar un commit con el veredicto de otra IA; main solo avanza por PR.', 'En su puesto; las puertas del carril se encienden con cada commit.', 'Cada commit y cada push.', []],
  sonar: ['SonarQube', 'Análisis estático y una barrera de calidad sobre el código que cambias.', 'En su puesto; se enciende cuando se juzga la barrera.', 'El método, antes de un commit.', []],
  ledger: ['Ledger', 'Sella cada comando, veredicto y excepción en una cadena de hashes: el pasado no se reescribe sin que se vea.', 'En su puesto; se enciende con cada sello.', 'Cada evento sellado.', []],
  steward: ['Steward', 'Vuelve a verificar las garantías según su calendario; la evidencia caducada deja de contar.', 'En su puesto; se enciende cuando comprueba.', 'Su calendario.', []],
  atril: ['atril', 'El atril: skills, comandos y subagentes, cargados cuando una tarea los necesita.', 'Siempre, junto a kaRAGan. Un anfitrión lee en él antes de empezar una card.', 'kj hu start, cuando una card trae skills.', []],
  wall: ['Tablero de tareas', 'Las cards del proyecto en tres columnas: por hacer, en curso, hechas.', 'Siempre, junto a los puestos.', 'El board; los mensajeros clavan y recogen sus cards.', []],
  release: ['Listo para release', 'Una mesa con las cards hechas desde la última release, y el contador con esa release.', 'Siempre; la pila crece con cada card hecha.', 'Las cards hechas. Una release la vacía.', []],
  drone: ['Dron de la release', 'Levanta la pila de «Ready to release» y se la lleva volando.', 'Cuando se publica una release.', 'Una release.', []],
  mailbox: ['Buzón', 'Guarda lo que los agentes te han dejado por hacer (handoffs).', 'Siempre, en la esquina delantera derecha de la fábrica.', 'Los agentes, con kj handoff add.', [['Brillo ámbar, parpadeando', 'Algo te espera.']]],
};

/** The legend's cards in `lang` (English when there is no other). */
export function cardsIn(lang) {
  if (lang === 'es') {
    return CARDS.map((card) => {
      const [name, does, when, calledBy, marks] = ES[card.id];
      return { ...card, name, does, when, calledBy, marks: marks.map(([mark, means]) => ({ mark, means })) };
    });
  }
  return CARDS;
}

export const kindsIn = (lang) => (lang === 'es' ? KINDS_ES : KINDS);
export const labelsIn = (lang) => LABELS[lang] ?? LABELS.en;

/** The language to show: the one `chosen` before, else Spanish for a Spanish `browser`, else English. */
export function langOf(chosen, browser) {
  if (LANGS.includes(chosen)) return chosen;
  return String(browser ?? '').startsWith('es') ? 'es' : 'en';
}
