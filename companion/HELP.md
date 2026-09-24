## Net Insight Nimbra Edge

### Getting Started

1. Enter the hostname of your Nimbra Edge server (e.g. `edge.nimbra.io`). The module connects over HTTPS.
2. Enter the username and password of a Nimbra Edge user. It is recommended to create a dedicated user for this connection.
3. Optionally adjust the poll interval (default 5 seconds).

### Actions

- **Route Input to Output** – route a specific input to a specific output (or disconnect it).
- **XY: Select Output** / **XY: Take Input** – router-style: select a destination, then press a source to route it.
- **Restart Appliance** – restarts an appliance. Streams through it will be interrupted.

### Feedbacks

- **Input Health State** / **Output Health State** – match a health state, or any unhealthy state.
- **Output Routed from Input** – tally for direct routing buttons.
- **XY: Output Selected** / **XY: Input is routed to selected output** – tally for XY buttons.
- **Appliance Status** – match a connection state, or not connected.
- **Appliance CPU / Memory Above Threshold** – CPU or memory usage at or above a percentage.
- **Alarm Active** – any active alarm at or above a severity, optionally for one input/output.

### Variables

- Counts: `input_count`, `output_count`, `appliance_count`, `appliance_offline_count`, `alarm_count`, `alarm_critical`, `alarm_major`, `alarm_minor`, `alarm_warning`
- XY: `selected_output_name`, `selected_output_source_name`
- Per input: `input_<id>_name`, `_status`, `_appliance`, `_type`, `_format`, `_services`, `_enabled`, `_alarms`, `_outputs`
- Per output: `output_<id>_name`, `_status`, `_appliance`, `_type`, `_format`, `_services`, `_enabled`, `_alarms`, `_source`, `_input_id`
- Per appliance: `appliance_<id>_name`, `_status`, `_cpu`, `_memory`, `_type`, `_regions`, `_alarms`, `_last_seen`

`<id>` is the Edge id (UUID) of the input, output or appliance. `output_<id>_input_id` holds the id of the routed input (empty when disconnected), matching the input option of **Route Input to Output**.

### Presets

Generated automatically from the server:

- **XY routing** – a take button per input and a select button per output.
- **Status** – active alarm count and per-severity counts, plus a status button per input, output and appliance.
