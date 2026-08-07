<?php

namespace App\Services\ModeProfiles;

class HardcodedModeProfileCatalog implements ModeProfileCatalog
{
    public function find(string $mode): ?array
    {
        return $this->profiles()[strtoupper($mode)] ?? null;
    }

    /**
     * Every profile, keyed by mode.
     *
     * This class is no longer the runtime catalogue — DbModeProfileCatalog is (see
     * AppServiceProvider). It is kept as the seed source for the mode_profiles migration and as a
     * known-good baseline the parity test compares the database against, so changes here stay
     * meaningful rather than dead code.
     */
    public function all(): array
    {
        return $this->profiles();
    }

    public function template(string $mode, string $role, string $templateId): ?array
    {
        $profile = $this->find($mode);

        if (! $profile) {
            return null;
        }

        foreach ($profile['roles'] ?? [] as $profileRole) {
            if (($profileRole['role'] ?? null) !== $role) {
                continue;
            }

            foreach ($profileRole['templates'] ?? [] as $template) {
                if (($template['id'] ?? null) === $templateId) {
                    return $template;
                }
            }
        }

        return null;
    }

    private function profiles(): array
    {
        return [
            'ARR' => [
                'mode' => 'ARR',
                'label' => 'ARR (Rainfall Recorder)',
                'description' => 'Siapkan mode, sensor curah hujan, sumber ARR, dan mapping data dalam satu alur.',
                'enabled' => true,
                'disabled_reason' => null,
                'roles' => [
                    [
                        'role' => 'rainfall',
                        'label' => 'Sensor Curah Hujan',
                        'required' => true,
                        'templates' => [
                            [
                                'id' => 'tb-400-04',
                                'name' => 'TB-400-04',
                                'description' => 'Sensor curah hujan Modbus RS485 dengan tiga parameter akumulasi.',
                                'enabled' => true,
                                'disabled_reason' => null,
                                'connection_type' => 'rs485',
                                'user_inputs' => [$this->slaveInput()],
                                'device' => [
                                    'device_name' => 'TB-400-04',
                                    'function_code' => 3,
                                    'register_address' => 0,
                                    'baudrate' => 9600,
                                    'serial_format' => '8N1',
                                ],
                                'parameters' => [
                                    [
                                        'name' => 'Rain_Day',
                                        'unit' => 'mm',
                                        'scale_factor' => 0.1,
                                        'register_address' => 0,
                                        'reg_count' => 1,
                                        'data_type_label' => 'Unsigned 16-bit',
                                        'fast_poll' => false,
                                    ],
                                    [
                                        'name' => 'Rain_Minute',
                                        'unit' => 'mm',
                                        'scale_factor' => 0.1,
                                        'register_address' => 1,
                                        'reg_count' => 1,
                                        'data_type_label' => 'Unsigned 16-bit',
                                        'fast_poll' => false,
                                    ],
                                    [
                                        'name' => 'Rain_Hour',
                                        'unit' => 'mm',
                                        'scale_factor' => 0.1,
                                        'register_address' => 2,
                                        'reg_count' => 1,
                                        'data_type_label' => 'Unsigned 16-bit',
                                        'fast_poll' => false,
                                    ],
                                ],
                            ],
                            [
                                'id' => 'sem400',
                                'name' => 'SEM400',
                                'description' => 'Template disiapkan untuk katalog, tetapi register map belum dikonfirmasi.',
                                'enabled' => false,
                                'disabled_reason' => 'Template belum lengkap',
                                'connection_type' => 'rs485',
                                'user_inputs' => [$this->slaveInput()],
                                'device' => null,
                                'parameters' => [],
                            ],
                        ],
                    ],
                ],
                'automatic_calibration' => [
                    'source' => 'Rain_Day',
                    'sensor' => 'TB-400-04',
                ],
                'calibration' => null,
                'default_mapping' => [
                    'ARR.Rainfall_Minute',
                    'ARR.Rainfall_Hour',
                    'ARR.Rainfall_Day',
                    'ARR.Status_Modbus',
                ],
            ],
            'AWR' => [
                'mode' => 'AWR',
                'label' => 'AWR (Automatic Weather Recorder)',
                'description' => 'Siapkan logger cuaca dengan rain gauge, pyranometer, weather, wind, dan illuminance RS485.',
                'enabled' => true,
                'disabled_reason' => null,
                'roles' => [
                    [
                        'role' => 'rainfall',
                        'label' => 'Rain Gauge',
                        'required' => true,
                        'templates' => [
                            $this->rs485Template(
                                id: 'tb-400-04',
                                name: 'TB-400-04',
                                description: 'Sensor curah hujan Modbus RS485.',
                                deviceName: 'TB-400-04',
                                defaultSlaveId: 1,
                                parameters: [
                                    $this->u16Parameter('Rainfall_Day', 'mm', 0.1, 0),
                                    $this->u16Parameter('Rainfall_Minute', 'mm', 0.1, 1),
                                    $this->u16Parameter('Rainfall_hour', 'mm', 0.1, 2),
                                ],
                            ),
                        ],
                    ],
                    [
                        'role' => 'pyranometer',
                        'label' => 'Pyranometer',
                        'required' => true,
                        'templates' => [
                            $this->rs485Template(
                                id: 'rk-200-03',
                                name: 'RK-200-03',
                                description: 'Sensor pyranometer Modbus RS485.',
                                deviceName: 'Pyranometer',
                                defaultSlaveId: 2,
                                parameters: [
                                    $this->u16Parameter('Pyranometer', 'w/m2', 1, 0),
                                ],
                            ),
                        ],
                    ],
                    [
                        'role' => 'weather',
                        'label' => 'Weather',
                        'required' => true,
                        'templates' => [
                            $this->rs485Template(
                                id: 'rk-330-01',
                                name: 'RK-330-01',
                                description: 'Sensor temperature, humidity, dan pressure Modbus RS485.',
                                deviceName: 'weather',
                                defaultSlaveId: 3,
                                parameters: [
                                    $this->u16Parameter('Temperature', 'C', 0.1, 0),
                                    $this->u16Parameter('Humidity', '%RH', 0.1, 1),
                                    $this->u16Parameter('Pressure', 'mbar', 0.1, 2),
                                ],
                            ),
                        ],
                    ],
                    [
                        'role' => 'wind',
                        'label' => 'Wind',
                        'required' => true,
                        'templates' => [
                            $this->rs485Template(
                                id: 'rk-120-01c',
                                name: 'RK-120-01C',
                                description: 'Sensor kecepatan dan arah angin Modbus RS485.',
                                deviceName: 'wind',
                                defaultSlaveId: 4,
                                parameters: [
                                    $this->u16Parameter('w_speed', 'm/s', 0.1, 0),
                                    $this->u16Parameter('w_direction', 'deg', 0.1, 1),
                                ],
                            ),
                        ],
                    ],
                    [
                        'role' => 'illuminance',
                        'label' => 'Illuminance',
                        'required' => true,
                        'templates' => [
                            $this->rs485Template(
                                id: 'rk-210-01',
                                name: 'RK-210-01',
                                description: 'Sensor illuminance Modbus RS485.',
                                deviceName: 'illuminance',
                                defaultSlaveId: 5,
                                parameters: [
                                    $this->u16Parameter('illuminance', 'lux', 0.1, 0),
                                ],
                            ),
                        ],
                    ],
                ],
                'automatic_calibration' => null,
                'calibration' => null,
                'default_mapping' => [],
            ],
            'AWLR_TD' => [
                'mode' => 'AWLR_TD',
                'label' => 'AWLR Transducer',
                'description' => 'Siapkan pressure transducer, mapping data AWLR, lalu lanjutkan kalibrasi muka air.',
                'enabled' => true,
                'disabled_reason' => null,
                'roles' => [
                    [
                        'role' => 'water_level',
                        'label' => 'Sensor AWLR',
                        'required' => true,
                        'templates' => [
                            [
                                'id' => 'transducer',
                                'name' => 'Tranduser',
                                'description' => 'Pressure transducer Modbus RS485 untuk pembacaan tinggi muka air.',
                                'enabled' => true,
                                'disabled_reason' => null,
                                'connection_type' => 'rs485',
                                'user_inputs' => [$this->slaveInput()],
                                'device' => [
                                    'device_name' => 'Tranduser',
                                    'function_code' => 3,
                                    'register_address' => 19,
                                    'baudrate' => 9600,
                                    'serial_format' => '8N1',
                                ],
                                'parameters' => [
                                    [
                                        'name' => 'Water_level',
                                        'unit' => 'mm',
                                        'scale_factor' => 0.001,
                                        'register_address' => 19,
                                        'reg_count' => 5,
                                        'data_type_label' => 'Unsigned 32-bit (Big Endian)',
                                        'fast_poll' => false,
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                'automatic_calibration' => null,
                'calibration' => [
                    'source' => 'Water_level',
                    'fields' => [
                        [
                            'key' => 'sumur',
                            'label' => 'Kedalaman Sumur',
                            'unit' => 'm',
                            'type' => 'number',
                            'min' => 0,
                            'step' => 0.01,
                        ],
                        [
                            'key' => 'muka_air',
                            'label' => 'TMA / Muka Air',
                            'unit' => 'm',
                            'type' => 'number',
                            'min' => 0,
                            'step' => 0.01,
                        ],
                    ],
                ],
                'default_mapping' => [
                    'AWLR_TD.TMA',
                    'AWLR_TD.Kedalaman_Air',
                    'AWLR_TD.Pembacaan_Sensor',
                    'AWLR_TD.Status_Modbus',
                ],
            ],
            'AWLR_US' => [
                'mode' => 'AWLR_US',
                'label' => 'AWLR Ultrasonik/Radar',
                'description' => 'Profil akan tersedia setelah register map dan cara interpretasi jarak sensor dikonfirmasi.',
                'enabled' => false,
                'disabled_reason' => 'Template sensor radar/ultrasonik belum lengkap',
                'roles' => [],
                'automatic_calibration' => null,
                'calibration' => null,
                'default_mapping' => [],
            ],
            'APMS' => [
                'mode' => 'APMS',
                'label' => 'APMS (Automatic Peatland Monitoring System)',
                'description' => 'Profil gabungan AWLR, ARR, kelembapan tanah, kalibrasi, dan mapping data.',
                'enabled' => false,
                'disabled_reason' => 'Template sensor kelembapan tanah belum lengkap',
                'roles' => [
                    [
                        'role' => 'water_level',
                        'label' => 'Sensor AWLR',
                        'required' => true,
                        'templates' => [],
                    ],
                    [
                        'role' => 'rainfall',
                        'label' => 'Sensor Curah Hujan',
                        'required' => true,
                        'templates' => [],
                    ],
                    [
                        'role' => 'soil_moisture',
                        'label' => 'Sensor Kelembapan Tanah',
                        'required' => true,
                        'templates' => [],
                    ],
                ],
                'automatic_calibration' => null,
                'calibration' => null,
                'default_mapping' => [
                    'APMS.TMA',
                    'APMS.kedalaman_air',
                    'APMS.pembacaan_awlr',
                    'APMS.Rainfall_Minute',
                    'APMS.Rainfall_hour',
                    'APMS.Rainfall_Day',
                    'APMS.soil_moisture',
                    'APMS.status_modbus',
                ],
            ],
        ];
    }

    private function rs485Template(
        string $id,
        string $name,
        string $description,
        string $deviceName,
        int $defaultSlaveId,
        array $parameters,
    ): array {
        return [
            'id' => $id,
            'name' => $name,
            'description' => $description,
            'enabled' => true,
            'disabled_reason' => null,
            'connection_type' => 'rs485',
            'user_inputs' => [$this->slaveInput($defaultSlaveId)],
            'device' => [
                'device_name' => $deviceName,
                'function_code' => 3,
                'register_address' => 0,
                'baudrate' => 9600,
                'serial_format' => '8N1',
            ],
            'parameters' => $parameters,
        ];
    }

    private function u16Parameter(
        string $name,
        string $unit,
        float|int $scaleFactor,
        int $registerAddress,
    ): array {
        return [
            'name' => $name,
            'unit' => $unit,
            'scale_factor' => $scaleFactor,
            'register_address' => $registerAddress,
            'reg_count' => 1,
            'data_type_label' => 'Unsigned 16-bit',
            'fast_poll' => false,
        ];
    }

    private function slaveInput(int $default = 1): array
    {
        return [
            'key' => 'slave_id',
            'label' => 'Slave ID',
            'type' => 'number',
            'min' => 1,
            'max' => 10,
            'default' => $default,
            'required' => true,
        ];
    }
}
