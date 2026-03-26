# Por qué JavaScript vanilla: la versión larga

Llevo usando JavaScript desde 1997. Casi desde que existe. Cuando Brendan Eich lo creó en diez días —la historia oficial dice una semana, aunque el proceso fue algo más largo— y Netscape lo incluyó en su navegador, muchos lo descartamos como un juguete. Luego nos dimos cuenta de que ese juguete nos permitía dar interactividad al HTML sin recargar la página, y aquello fue un descubrimiento enorme. No exagero si digo que JS me cambió la vida como programador.

JavaScript es un lenguaje de scripting orientado a prototipos. Eso es algo que poca gente recuerda hoy, y cada vez menos, desde que se le añadió azúcar sintáctico con las clases de ES6. La programación orientada a prototipos es un modelo distinto al de la orientación a objetos clásica: no hay clases en el sentido tradicional, hay objetos que heredan directamente de otros objetos. Es un paradigma elegante y potente que quedó sepultado bajo capas de sintaxis diseñadas para que los developers de Java se sintieran como en casa.

JS tuvo sus años oscuros. Después del boom inicial vino casi una década de abandono, de IE haciendo lo que le daba la gana, de Flash compitiendo con él, de todo el mundo mirando para otro lado. Hasta que llegó Node.js, el V8 de Google, y de repente JS no era solo para el navegador: podía correr en el servidor, podía hacer cosas serias. Eso, junto con la retomada del desarrollo del estándar con ES5 y luego ES6, relanzó el lenguaje y lo convirtió en lo que es hoy.

Pero JS sigue siendo JS. Un lenguaje débilmente tipado, diseñado para convivir con HTML y CSS en el navegador. Eso también se olvida. Por eso en el browser tenemos el árbol DOM y en Node no. Son contextos distintos. Y JS abraza esa dualidad sin disculparse.

Lo que los programadores de JS veteranos aprendimos, con el tiempo, es que sus rarezas no son accidentes: son la personalidad del lenguaje. Que `0.3 === 0.1 + 0.2` sea `false` tiene una explicación perfectamente razonable en cómo los ordenadores representan números en coma flotante. Que `[] == false` sea `true` y `[] === false` sea `false` al mismo tiempo tiene que ver con la coerción de tipos y la diferencia entre igualdad abstracta y estricta. Que `NaN === NaN` sea `false` es una consecuencia directa del estándar IEEE 754. Ninguna de estas cosas es un bug si entiendes por qué ocurre. Y si las entiendes, las usas a tu favor o simplemente las evitas con criterio.

Tengo una analogía para JS que uso a menudo. Imagina una puerta que al construirse quedó encajada un poco de abajo. Para abrirla tienes que girar la llave, girar el pomo, y darle un golpe con el pie en la parte inferior para desencajarla. Cualquiera diría que está mal construida. Tiene razón. Pero esa puerta da a mi trastero, y ese comportamiento inesperado se ha convertido en un sistema de seguridad informal: nadie que no conozca el secreto es capaz de abrirla aunque tenga la llave. El bug se convirtió en feature. Con JS pasa igual. Sus peculiaridades, una vez interiorizadas, dejan de ser obstáculos y se vuelven herramientas.

Los problemas que he tenido con JavaScript en mi vida no vinieron del lenguaje. Vinieron de no tener tests. De no tener JSDoc. De no tener un IDE que me avisara cuando hacía algo descuidado. Cuando tienes esas tres cosas, la mayoría de los argumentos contra JS vanilla se evaporan.

Y luego está TypeScript. Quiero ser claro sobre esto porque hay mucha confusión. TypeScript existe por una razón muy concreta: para que developers acostumbrados a lenguajes fuertemente tipados (Java, C#, C++) puedan usar JavaScript sin que les dé un síncope. Es un puente. Y como puente, cumple su función perfectamente. Aplaudo que exista porque ha traído a JS a gente que de otra manera nunca lo habría tocado, y eso ha enriquecido el ecosistema.

Pero eso no significa que sea mejor. Significa que es mejor para ellos. Para alguien que no conoce JS por dentro, que viene de un mundo donde el compilador es tu red de seguridad, TypeScript tiene sentido. Es como aprender a ir en bici con ruedines. Más seguro al principio. Pero no me digas que los ruedines son mejores que pedalear sin ellos. Depende de para quién.

Para mí, TypeScript es una capa de abstracción entre el código y yo. Necesito un compilador, necesito configuración, necesito mantener tipos que a menudo ya están implícitos en la lógica del programa. Mientras TS no sea parte del estándar de JavaScript, y aunque lo fuera, dado que JS es retrocompatible, no lo voy a usar. No porque no pueda, sino porque no lo necesito.

Y para quien piense que esto es ignorancia o nostalgia: programo en C. Programé en C++. Tuve mi época de Java, corta pero real. Escribí ensamblador del Z80 y de microcontroladores, además de BASIC cuando era crío. Conozco lo que es un sistema de tipos estático. Sé lo que me estoy perdiendo, si es que me estoy perdiendo algo.

Pero ningún lenguaje me ha enamorado como JavaScript. Ninguno me ha dado esa combinación de inmediatez, flexibilidad, ubicuidad y profundidad. JS corre en el navegador, en el servidor, en microcontroladores, en scripts de terminal, en extensiones de editor. Es el único lenguaje que puedo abrir en cualquier ordenador del mundo, escribir código y ejecutarlo sin instalar nada. Eso tiene un valor que no aparece en los benchmarks de tipos estáticos.

Karajan tiene hoy más de 2000 tests en más de 160 ficheros. Corre en Node.js sin paso de build. Puedes leer el código fuente, entenderlo, forkearlo y modificarlo sin un compilador entre tú y el código. 57 releases en 45 días. Esa velocidad no es a pesar de usar JavaScript vanilla. Es gracias a ello.

---

*[@manufosela](https://github.com/manufosela)*
