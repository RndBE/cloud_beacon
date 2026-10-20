// Defaults of the Add/Edit Sensor form on the logger page; also the body
// shape the assistant sends to POST /loggers/{id}/sensors.
export const EMPTY_SENSOR_FORM = {
    name: '',
    type: 'temperature' as string,
    unit: '°C',
    status: 'active' as string,
    min_value: '0' as string, // string-backed so float entry (e.g. 100.0 / 55.6) isn't clobbered
    max_value: '100' as string,
    connection_type: '' as string,
    modbus_slave_id: 1,
    device_name: '',
    function_code: 3,
    register_address: 0,
    reg_count: 1,
    baudrate: 9600,
    serial_format: '8N1',
    scale_factor: '1' as string, // string-backed so float entry (e.g. 0.1) isn't clobbered

    channel: 1,
    analog_mode: 1,
    port: 1,
    digital_mode: 0,
    label_high: 'HIGH',
    label_low: 'LOW',
    debounce_ms: 50,
    invert_logic: false,
    pulse_submode: 0,
    timeout_sec: 5,
    default_state: 0,
    failsafe: 0,
    fast_poll: false,
};

// Mirror of MqttService::guessSensorType — derive a sensor `type` from name/unit so
// RS232/Analog/Digital forms don't need to show a Type dropdown.
export function guessSensorType(name: string, unit: string): string {
    const n = name.toLowerCase();
    const u = unit.toLowerCase();
    if (n.includes('temp') || u === '°c') return 'temperature';
    if (n.includes('hum') || u === '%rh') return 'humidity';
    if (n.includes('press') || u === 'hpa') return 'pressure';
    if (n.includes('water') || n.includes('level')) return 'water-level';
    if (n.includes('flow')) return 'flow-rate';
    if (n.includes('rain')) return 'rainfall';
    if (n.includes('volt') || u === 'v') return 'voltage';
    if (n.includes('current') || u === 'a') return 'current';
    return 'pressure';
}
