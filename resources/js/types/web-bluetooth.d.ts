export {};

// The slice of the Web Bluetooth API (Chrome, Edge, Android Chrome) the Security
// System setup uses; TypeScript's DOM library does not include it.
declare global {
    interface BluetoothRemoteGATTCharacteristic extends EventTarget {
        readonly value?: DataView;
        writeValueWithResponse(value: BufferSource): Promise<void>;
        startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    }

    interface BluetoothRemoteGATTService {
        getCharacteristic(
            uuid: string,
        ): Promise<BluetoothRemoteGATTCharacteristic>;
    }

    interface BluetoothRemoteGATTServer {
        readonly connected: boolean;
        connect(): Promise<BluetoothRemoteGATTServer>;
        disconnect(): void;
        getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
    }

    interface BluetoothDevice extends EventTarget {
        readonly name?: string;
        readonly gatt?: BluetoothRemoteGATTServer;
    }

    interface BluetoothRequestDeviceOptions {
        filters?: Array<{
            services?: string[];
            name?: string;
            namePrefix?: string;
        }>;
        optionalServices?: string[];
    }

    interface Bluetooth {
        requestDevice(
            options: BluetoothRequestDeviceOptions,
        ): Promise<BluetoothDevice>;
    }

    interface Navigator {
        readonly bluetooth: Bluetooth;
    }
}
