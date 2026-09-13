# Cómo escribir una spec para Karajan

No hace falta un documento formal. Con responder a esto, Karajan tiene lo justo
para planificar sin adivinar:

- **El problema.** Qué duele hoy y para quién. Una o dos frases.
- **Lo que quieres poder hacer al terminar.** Descríbelo como algo observable
  ("un visitante puede reservar y recibir confirmación"), no como una lista de
  features.
- **Restricciones reales.** Plazo, presupuesto, dónde tiene que correr, con qué
  sistemas convive, qué está prohibido.
- **No-objetivos.** Lo que NO vas a construir ahora; evita que el agente se
  disperse.
- **Lo que te da igual que decida Karajan.** Si no tienes opinión sobre el stack
  o la arquitectura, dilo: te propondrá opciones y las dejará como ADR para que
  las apruebes, en vez de preguntarte por todo.

Ejemplo mínimo:

> Problema: los clientes de mi peluquería reservan por WhatsApp y se me solapan
> las citas.
> Al terminar: un cliente elige servicio, ve huecos reales y reserva; yo veo la
> agenda del día.
> Restricciones: web, móvil primero, sin coste de licencias, en producción en
> 3 semanas.
> No-objetivos: pagos online, programa de fidelización.
> Me da igual: el framework, mientras siga siendo mantenible.

Cuanto más claro el "al terminar" y los "no-objetivos", menos vueltas dará
Karajan.

Cuando lo tengas, pega [brief.md](https://karajancode.com/es/brief.md) en tu
agente y responde a sus preguntas.
