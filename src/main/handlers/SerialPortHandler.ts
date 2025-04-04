import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';

class SerialPortHandler extends EventEmitter {
  private port: SerialPort | null = null;

  constructor() {
    super();

    this.on('list-ports', async () => {
      const ports = await SerialPort.list();
      const portPaths = ports.map((port) => port.path);
      this.emit('available-ports', portPaths);
      console.log(portPaths);
    });
  }

  write_data(data: Buffer) {
    this.port?.write(data);
  }

  async connect(path: string, baudRate: number) {
    console.log('Connecting to port:', path, 'at baud rate:', baudRate);

    const openCallback = (err: any) => {
      if (err) {
        this.emit('open-callback', err.message);
      } else {
        this.emit(
          'open-callback',
          `Connected to port: ${path} at baud rate: ${baudRate}`,
        );
      }
    };

    // Disconnect from any existing port
    if (this.port && this.port.isOpen) {
      console.log('Disconnecting from existing port:', this.port.path);
      await new Promise<void>((resolve, reject) => {
        this.port?.close((err) => {
          if (err) {
            console.error('Error closing port:', err.message);
            this.emit('error', err);
            reject(err);
          } else {
            console.log('Port closed');
            this.emit('close', `Disconnected from port: ${this.port?.path}`);
            this.port = null; // Ensure the port reference is cleared
            resolve();
          }
        });
      });
    }

    this.port = new SerialPort(
      {
        path,
        baudRate,
      },
      openCallback,
    );

    this.port.on('open', () => {
      console.log('Port opened');
      this.emit('open', `Connected to port: ${path} at baud rate: ${baudRate}`);
    });

    this.port.on('data', (data: Buffer) => {
      this.emit('data', data);
    });

    this.port.on('error', (err: Error) => {
      console.error('Error:', err.message);
      this.emit('error', err);
    });
  }
}

export default SerialPortHandler;