# AppReg - Manual de uso por pantalla

Este instructivo esta pensado para uso operativo diario de caja.

## 1) Objetivo de la aplicacion

AppReg permite:
- Registrar operaciones diarias con multiples conceptos y medios de pago.
- Controlar ingresos y egresos por fecha operativa.
- Hacer arqueo de efectivo.
- Realizar cierres diarios (incluye cortes multiples en un mismo dia).
- Auditar trazabilidad y continuidad por medio de pago.

## 2) Mapa de pantallas

- Inicio
- Registro diario
- Ingresos de caja
- Egresos de caja
- Control de caja
- Cierre diario
- Trazabilidad de caja
- Configuracion

---

## 3) Instructivo por pantalla

### 3.1 Inicio

Para que sirve:
- Ver estado general del dia (inicio por medio, KPIs, ultimo registro).
- Ver fecha/hora operativa, clima y dolar de referencia.

Que mirar primero:
- Inicio de caja por medio de pago.
- Referencia de cierre base (fecha, ID y fecha/hora de generacion).
- Registros del dia y total cargado.

Buenas practicas:
- Confirmar que el inicio de caja coincida con el ultimo cierre real.
- Si hay diferencia, revisar Trazabilidad antes de operar.

---

### 3.2 Registro diario

Para que sirve:
- Registrar operaciones comerciales del dia con:
  - Multiples conceptos.
  - Multiples medios de pago.

Campos clave:
- Nro recibo.
- Nombre /Dominio.
- Conceptos del registro (Importe por concepto).
- Medios de pago del registro (Importe por medio).

Reglas importantes:
- El formulario solo permite guardar si:
  - Subtotal conceptos > 0.
  - Total de medios = subtotal (diferencia 0).
- Los importes:
  - Admiten coma decimal.
  - Admiten separador de miles con punto.
  - Se seleccionan automaticamente al hacer foco.

Comportamiento post-cierre:
- Esta pantalla muestra movimientos pendientes del dia.
- Al registrar un cierre, los movimientos ya cerrados dejan de verse aqui.
- Se conserva la base de saldos para continuar operando.

---

### 3.3 Ingresos de caja

Para que sirve:
- Registrar ingresos manuales de caja por fecha operativa.

Campos clave:
- Tipo de ingreso.
- Concepto.
- Monto.
- Medio de pago.
- Observacion / Comprobante.

Impacto:
- Aumenta ingresos del dia.
- Afecta saldo del medio de pago seleccionado.
- Se refleja en Control, Cierre y Trazabilidad.

Consejo:
- Usar comprobante siempre que exista para auditoria posterior.

---

### 3.4 Egresos de caja

Para que sirve:
- Registrar salidas de dinero (retiros, depositos, gastos varios).

Campos clave:
- Tipo de salida.
- Concepto/detalle.
- Monto.
- Medio de pago.
- Observacion / Comprobante.

Validacion importante:
- El sistema valida disponibilidad por medio.
- No permite registrar un egreso si supera disponible del medio.

Impacto:
- Descuenta egresos del dia.
- Ajusta neto y saldo por medio.

---

### 3.5 Control de caja

Para que sirve:
- Hacer arqueo de billetes contra efectivo esperado.

Como se calcula el efectivo esperado:
- Efectivo esperado = Inicio efectivo del dia + Neto pendiente en efectivo.

Que incluye la pantalla:
- Conteo por denominacion.
- Alta de billetes manuales.
- Total contado.
- Inicio efectivo del dia.
- Ingresos y egresos en efectivo.
- Diferencia de arqueo (contado vs esperado).

Interpretacion:
- Diferencia 0: arqueo conciliado.
- Diferencia distinta de 0: revisar movimientos, comprobantes y cortes.

---

### 3.6 Cierre diario

Para que sirve:
- Realizar cortes operativos del dia y consolidar continuidad.

Conceptos clave:
- Se pueden registrar multiples cortes en el mismo dia.
- Cada corte guarda referencias de movimientos incluidos.
- El siguiente corte toma como base la continuidad acumulada.

Secciones utiles:
- Resumen del dia (ingresos, egresos, neto).
- Detalle por medio.
- Observacion del corte.
- PDF de conciliacion previa.
- Historial mensual de cierres.

Resultado esperado al cerrar:
- Los movimientos incluidos pasan a estado cerrado.
- Registro diario muestra solo nuevos pendientes.

---

### 3.7 Trazabilidad de caja

Para que sirve:
- Auditar continuidad y correlatividad de caja por periodo.

Bloques principales:
- KPI del periodo.
- Auditoria de continuidad de efectivo (alertas de diferencia).
- Correlatividad por medio de pago:
  - Saldo inicial.
  - Ingresos.
  - Egresos.
  - Neto.
  - Saldo final.
- Detalle diario consolidado por cierre:
  - Fecha operativa.
  - Fecha y hora del cierre.
  - ID de cierre.
  - Totales y detalle por medio.

Importante:
- El historial consolidado muestra cierres completos (no agrupados).
- Permite reconstruir exactamente cada corte.

---

### 3.8 Configuracion

Para que sirve:
- Mantener catalogos operativos sin tocar codigo.

Catalogos editables:
- Conceptos.
- Medios de pago.
- Tipos de salida.
- Tipos de ingreso.

Impacto:
- Cambios aplican en formularios operativos del sistema.

Buenas practicas:
- Estandarizar nombres (mayusculas y terminos unicos).
- Evitar duplicados semanticamente equivalentes.

---

## 4) Flujo de trabajo recomendado (paso a paso)

### Apertura del dia
1. Revisar Inicio:
   - Validar saldos iniciales por medio.
   - Confirmar cierre base.
2. Revisar Configuracion (si hay cambios de operacion).

### Operacion diaria
1. Registrar operaciones en Registro diario.
2. Cargar ingresos extraordinarios en Ingresos de caja.
3. Registrar egresos en Egresos de caja.
4. Usar Control de caja para arqueos parciales durante el dia.

### Cortes y cierre
1. Ir a Cierre diario.
2. Revisar resumen y detalle por medio.
3. (Opcional) Generar PDF de conciliacion previa.
4. Registrar nuevo corte.
5. Repetir si se necesita mas de un corte en el mismo dia.

### Auditoria
1. Ir a Trazabilidad.
2. Revisar alertas de continuidad.
3. Ver correlatividad por medio y detalle por cierre.

---

## 5) Reglas operativas clave (resumen rapido)

- Nunca cerrar sin revisar neto y detalle por medio.
- En Registro diario, no forzar un registro con diferencia distinta de 0.
- En Egresos, respetar disponibilidad por medio.
- Si hay diferencias en arqueo, pausar y auditar antes del siguiente corte.
- Mantener observaciones y comprobantes para trazabilidad.

---

## 6) Preguntas frecuentes

### Por que no veo un movimiento en Registro diario?
Porque probablemente ya fue incluido en un cierre del dia.

### Puedo hacer mas de un cierre en el mismo dia?
Si. AppReg soporta multiples cortes diarios.

### Que pasa si no hubo cierre previo?
El inicio se toma en 0 hasta registrar el primer cierre.

### Donde audito diferencias historicas?
En Trazabilidad de caja, seccion de alertas y consolidado por cierre.

---

## 7) Recomendaciones de implementacion interna

- Definir un responsable por turno para cierre y arqueo.
- Estandarizar observaciones/comprobantes.
- Ejecutar auditoria en Trazabilidad al final del dia y al iniciar el siguiente.
- Mantener copia/export de PDF de conciliacion cuando el proceso lo requiera.

Fin del manual.
