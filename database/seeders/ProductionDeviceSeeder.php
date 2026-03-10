<?php

namespace Database\Seeders;

use App\Models\ProductionDevice;
use Illuminate\Database\Seeder;

class ProductionDeviceSeeder extends Seeder
{
    public function run(): void
    {
        $devices = [
            // ── Registered devices (used by LoggerSeeder) ──
            [
                'serial_number' => 'BLC-2024-00147',
                'device_id' => 'BEACON-KTL-01',
                'model' => 'Beacon Logger Pro X1',
                'hardware_version' => 'v2.1',
                'batch_number' => 'BATCH-2024-Q1-001',
                'production_date' => '2024-01-15',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2024-00089',
                'device_id' => 'BEACON-MGR-01',
                'model' => 'Beacon Logger Lite S1',
                'hardware_version' => 'v1.3',
                'batch_number' => 'BATCH-2024-Q1-002',
                'production_date' => '2024-02-01',
                'tested_by' => 'QC Team B',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2025-00012',
                'device_id' => 'BEACON-CLW-01',
                'model' => 'Beacon Logger Pro X2',
                'hardware_version' => 'v3.0',
                'batch_number' => 'BATCH-2025-Q1-001',
                'production_date' => '2025-01-10',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2024-00201',
                'device_id' => 'BEACON-KRT-01',
                'model' => 'Beacon Logger Lite S1',
                'hardware_version' => 'v1.3',
                'batch_number' => 'BATCH-2024-Q2-001',
                'production_date' => '2024-04-10',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2024-00152',
                'device_id' => 'BEACON-BMK-01',
                'model' => 'Beacon Logger Pro X1',
                'hardware_version' => 'v2.1',
                'batch_number' => 'BATCH-2024-Q1-001',
                'production_date' => '2024-01-16',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2024-00178',
                'device_id' => 'BEACON-BMK-02',
                'model' => 'Beacon Logger Pro X1',
                'hardware_version' => 'v2.1',
                'batch_number' => 'BATCH-2024-Q2-002',
                'production_date' => '2024-05-20',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2025-00034',
                'device_id' => 'BEACON-PDM-01',
                'model' => 'Beacon Logger Pro X2',
                'hardware_version' => 'v3.0',
                'batch_number' => 'BATCH-2025-Q1-002',
                'production_date' => '2025-02-15',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],
            [
                'serial_number' => 'BLC-2025-00041',
                'device_id' => 'BEACON-PDM-02',
                'model' => 'Beacon Logger Pro X1',
                'hardware_version' => 'v2.1',
                'batch_number' => 'BATCH-2025-Q1-002',
                'production_date' => '2025-02-18',
                'tested_by' => 'QC Team B',
                'qc_status' => 'passed',
                'is_registered' => true,
            ],

            // ── Unregistered devices (available for new loggers) ──
            [
                'serial_number' => 'BLC-2025-00050',
                'device_id' => 'DEV-050',
                'model' => 'Beacon Logger Pro X3',
                'hardware_version' => 'v4.0',
                'batch_number' => 'BATCH-2025-Q1-003',
                'production_date' => '2025-03-01',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => false,
            ],
            [
                'serial_number' => 'BLC-2025-00051',
                'device_id' => 'DEV-051',
                'model' => 'Beacon Logger Pro X3',
                'hardware_version' => 'v4.0',
                'batch_number' => 'BATCH-2025-Q1-003',
                'production_date' => '2025-03-02',
                'tested_by' => 'QC Team A',
                'qc_status' => 'passed',
                'is_registered' => false,
            ],
            [
                'serial_number' => 'BLC-2025-00052',
                'device_id' => 'DEV-052',
                'model' => 'Beacon Logger Lite v2',
                'hardware_version' => 'v2.0',
                'batch_number' => 'BATCH-2025-Q1-004',
                'production_date' => '2025-03-05',
                'tested_by' => 'QC Team B',
                'qc_status' => 'pending',
                'is_registered' => false,
            ],
            [
                'serial_number' => 'BLC-2025-00053',
                'device_id' => 'DEV-053',
                'model' => 'Beacon Logger Pro X3',
                'hardware_version' => 'v4.0',
                'batch_number' => 'BATCH-2025-Q1-005',
                'production_date' => '2025-03-10',
                'tested_by' => 'QC Team A',
                'qc_status' => 'failed',
                'is_registered' => false,
                'notes' => 'RS485 port defective. Needs replacement.',
            ],
        ];

        foreach ($devices as $device) {
            ProductionDevice::create($device);
        }
    }
}
