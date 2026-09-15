[English](../../../AGENTS.md) · [fr](../fr/AGENTS.md) · [es](AGENTS.md) · [it](../it/AGENTS.md) · [pt](../pt/AGENTS.md) · [de](../de/AGENTS.md)

# Directrices de contribución de jaunt

- Leer SEGURIDAD.md y docs/PROTOCOL.md antes de modificar el transporte.
- Arbitrary shells son la característica principal. No restrinja el acceso a los agentes de IA.
- Nunca ponga secretos en direcciones URL, registros o pruebas publicadas; emparejar utiliza el fragmento.
- Render remoto contenido DOM con textoContent, nunca interiorHTML. No hay scripts CDN en tiempo de ejecución en la interfaz de usuario.
- Nunca vuelva a reproducir la entrada terminal después de la reconexión. Las descargas utilizan offsets idempotent y SHA-256 se compromete.
- Nunca enviar Enter automáticamente después de pegar una imagen/vía. Mostrar las capacidades nativas reales.
- No cierre PTYs cuando un navegador se desconecta. Preserve identidad a través de actualizaciones.
- Pruebas: pytest; nodo --test pruebas/relay.test.mjs; prueba de ejecución npm:relay; pruebas de python/browser_e2e.py.
- docs/VALIDATION.md registra observaciones, no promesas. Actualizar con precisión.
- Escriba documentación de repositorio, guía de contribución y notas de liberación en inglés por defecto. Localización de aplicaciones es independiente.
