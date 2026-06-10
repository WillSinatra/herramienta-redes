# Herramienta de Redes

Aplicacion web local para diagnostico de red en Windows.
Permite ejecutar pruebas desde el navegador y ver resultados en tiempo real.

## Resumen

Con esta herramienta puedes consultar un host o IP usando:

- `nslookup` para resolucion DNS
- `ping` para conectividad basica
- `tracert` para ver saltos de red

La salida llega por streaming (SSE), asi que se muestra linea por linea sin esperar a que termine todo el comando.

## Uso rapido

1. Ejecuta `iniciar.bat`.
2. Abre `http://localhost:8080/`.
3. Escribe un host o IP.
4. Elige el comando y ejecuta.

Tambien puedes iniciar manualmente:

```bash
node server.js
```

## Funcionalidades

- Interfaz web local simple y directa.
- Ejecucion controlada de comandos de red comunes.
- Streaming en vivo de salida estandar y errores.
- Manejo de timeout por comando para evitar procesos colgados.
- Respuesta de fin de proceso con codigo de salida.

## Seguridad aplicada

- Lista blanca de comandos permitidos: `nslookup`, `ping`, `tracert`.
- Validacion del host con regex estricta.
- Ejecucion en proceso hijo con control de cierre.
- Corte automatico al exceder el tiempo maximo.

### Tiempos maximos

- `nslookup`: 10 segundos
- `ping`: 20 segundos
- `tracert`: 55 segundos

## Requisitos

- Windows
- Node.js 18 o superior

## Estructura del proyecto

```text
.
|-- index.html   # Interfaz web
|-- server.js    # Servidor HTTP y endpoint SSE
|-- iniciar.bat  # Inicio rapido
`-- server.ps1   # Inicio por PowerShell
```

## Como funciona tecnicamente

1. El navegador llama a `/api/stream` con `host` y `cmd`.
2. El servidor valida parametros y prepara el comando seguro.
3. Se ejecuta `cmd.exe /c ...` en un proceso hijo.
4. Cada linea de salida se envia como evento SSE.
5. Al cerrar, se emite estado final y se termina la conexion.

## Troubleshooting

- Puerto ocupado en `8080`:
  cambia `PORT` en `server.js` o libera el puerto en uso.
- No abre el navegador automaticamente:
  entra manualmente a `http://localhost:8080/`.
- Comando muy lento o sin respuesta:
  revisa conectividad/red local y prueba con otro host.

## Estado

Proyecto funcional para uso local y practicas de diagnostico de red.
