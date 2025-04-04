import { ipcMain } from 'electron';
import EventEmitter from 'events';
import { DataProcessor, ReadType, WriteType } from './DataProcessor';
import NotificationSender from './NotificationSender';
import SerialPortHandler from './SerialPortHandler';
import { BrowserWindow } from 'electron';
import {
  MachineState,
  SampleData,
  MachineConfiguration,
  Notification,
  NotificationType,
  Move,
  TestHeader,
} from '../../shared/SharedInterface';

function emitAndWaitForResponse(
  emitter: EventEmitter,
  emitEvent: string,
  responseEvent: string,
  timeout: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout error on ${responseEvent}`));
    }, timeout);

    emitter.once(responseEvent, (response) => {
      clearTimeout(timeoutId);
      resolve(response);
    });

    emitter.emit(emitEvent);
  });
}

function waitForResponse(
  emitter: EventEmitter,
  responseEvent: string,
  timeout: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout error on ${responseEvent}`)); // I think I need to pass something here, nuthing is returning undefined and im seconding it tostring after failed read of machineprofile after writing it...
    }, timeout);

    emitter.once(responseEvent, (response) => {
      clearTimeout(timeoutId);
      resolve(response);
    });
  });
}

class DeviceInterface {
  // Interface for handling device connections
  // also stores asyncronous data like state, data
  // will handle ack for retrying gcode messages etc
  private serialport: SerialPortHandler;

  private dataProcessor: DataProcessor;

  private notificationSender: NotificationSender;

  private sample_data_buffer: SampleData[] = [];

  private machine_state: MachineState | null = null;

  private machine_configuration: MachineConfiguration | null = null;

  private device_connected: boolean = false;

  private window: BrowserWindow;

  private sample_interval_ms: number;

  private last_sample_data_ms: number;

  constructor(
    dataProcessor: DataProcessor,
    notificationSender: NotificationSender,
    serialport: SerialPortHandler,
    window: BrowserWindow,
  ) {
    this.serialport = serialport;
    this.dataProcessor = dataProcessor;
    this.notificationSender = notificationSender;
    this.window = window;
    this.sample_interval_ms = 100;
    this.last_sample_data_ms = 0;

    // Periodic task to request SAMPLE every 100ms
    setInterval(() => {
      this.dataProcessor.readData(ReadType.SAMPLE);
      if (Date.now() - this.last_sample_data_ms > 1000) {
        this.device_connected = false;
      }
    }, this.sample_interval_ms);

    // Periodic task to request MACHINE_STATE every 100ms
    setInterval(() => {
      this.dataProcessor.readData(ReadType.STATE);
    }, 1000);

    ipcMain.handle('device-connect', async (event, path, baudRate) => {
      console.log('Attempting to connect to device');
      this.device_connected = false;
      await this.serialport.connect(path, baudRate);
      return waitForResponse(this.serialport, 'open-callback', 1000);
    });

    ipcMain.handle('device-list-ports', async () => {
      return emitAndWaitForResponse(
        this.serialport,
        'list-ports',
        'available-ports',
        1000,
      );
    });

    ipcMain.handle('device-data-all', async () => {
      return this.sample_data_buffer;
    });

    ipcMain.handle('sample-data-latest', async () => {
      return this.sample_data_buffer[this.sample_data_buffer.length - 1];
    });

    ipcMain.handle('device-state', async () => {
      if (this.machine_state === null) {
        return null;
      }
      return this.machine_state;
    });

    ipcMain.handle('device-connected', async () => {
      return this.device_connected;
    });

    ipcMain.handle('get-machine-configuration', async () => {
      console.log("Getting Machine Configuration");
      this.dataProcessor.readData(ReadType.MACHINE_CONFIGURATION);
      return waitForResponse(ipcMain, 'machine-configuration-updated', 1000);
    });

    ipcMain.handle('save-machine-configuration', async (event, newConfig: MachineConfiguration) => {
        this.dataProcessor.writeData(
          WriteType.MACHINE_CONFIGURATION,
          Buffer.from(JSON.stringify(newConfig)),
        );
        console.log("Saving Machine Configuration: ", newConfig);
        return true;
      },
    );

    ipcMain.handle('set-motion-enabled', async (event, enabled: boolean) => {
      this.dataProcessor.writeData(
        WriteType.MOTION_ENABLE,
        Buffer.from(enabled ? '1' : '0'),
      );
      return waitForResponse(ipcMain, 'motion-enabled-ack', 1000);
    });

    ipcMain.handle('manual-move', async (event, mm: number, speed: number) => {
      const move: Move = {
        G: 0,
        X: mm,
        F: speed,
        P: 0,
      };
      const moveString = `{
        "G": ${move.G},
        "X": ${move.X.toFixed(6)},
        "F": ${move.F.toFixed(6)},
        "P": ${move.P}
      }`;
      const incrementalMove = `{"G":91}`;
      this.dataProcessor.writeData(
        WriteType.MANUAL_MOVE,
        Buffer.from(incrementalMove),
      );
      this.dataProcessor.writeData(
        WriteType.MANUAL_MOVE,
        Buffer.from(moveString),
      );
      //return waitForResponse(ipcMain, 'motion-enabled-ack', 1000);
      return true;
    });

    ipcMain.handle('home', async (event) => {
      const homeMove = `{"G":28}`;
      this.dataProcessor.writeData(
        WriteType.MANUAL_MOVE,
        Buffer.from(homeMove),
      );
      return true;
    });

    ipcMain.handle('set_length_zero', async (event) => {
      this.dataProcessor.writeData(WriteType.GAUGE_LENGTH, Buffer.from([0]));
      return true;
    });

    ipcMain.handle('set_force_zero', async (event) => {
      this.dataProcessor.writeData(WriteType.GAUGE_FORCE, Buffer.from([0]));
      return true;
    });

    ipcMain.handle('run-test', async (event, { sampleProfile, gcode, testName }) => {
      //this.dataProcessor.writeData(WriteType.SAMPLE_PROFILE, Buffer.from(JSON.stringify(sampleProfile)));

      // Start test run (will clear gcode queue)
      this.dataProcessor.writeData(WriteType.TEST_RUN, Buffer.from(testName));

      // Wait for test run acknowledgment
      const testRunning = await waitForResponse(ipcMain, 'test-run-ack', 1000);
      if (!testRunning) {
        return false;
      }

      // Create a subprocess to stream G-code
      const streamGcode = async () => {
        try {
          // Stream each gcode line as JSON
          for (const line of gcode) {
            // Skip comments and blank lines
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith(';')) {
              let success = false;
              let retryCount = 0;
              const maxRetries = 3;

              while (!success && retryCount < maxRetries) {
                this.dataProcessor.writeData(
                  WriteType.TEST_MOVE,
                  Buffer.from(trimmedLine),
                );
                // Wait for acknowledgment before sending next line
                const ack = await waitForResponse(ipcMain, 'test-move-ack', 1000);
                if (ack) {
                  success = true;
                } else {
                  retryCount++;
                  console.log(`Retrying G-code line (attempt ${retryCount}/${maxRetries}):`, trimmedLine);
                  // Wait a bit before retrying
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              }

              if (!success) {
                console.error(`Failed to send G-code line after ${maxRetries} attempts:`, trimmedLine);
                // You might want to handle this error case differently
                // For example, stopping the test or notifying the user
              }
            }
          }
        } catch (error) {
          console.error('Error in G-code streaming process:', error);
        }
        this.dataProcessor.writeData(WriteType.TEST_MOVE, Buffer.from('G144'));
      };

      // Start the G-code streaming process
      streamGcode().catch(console.error);

      return true;
    });

    // Handle command acks
    dataProcessor.on('ack', (command: WriteType, ack: boolean) => {
      console.log('motion enabled ack1',command, ack);
      this.device_connected = true;
      switch (command) {
        case WriteType.MACHINE_CONFIGURATION:
          // Machine configuration successfully updated and saved
          if (ack) {
            notificationSender.sendSuccess('Machine Profile Updated, Please reboot');
          } else {
            notificationSender.sendError('Failed to update machine profile');
          }
          break;
        case WriteType.MOTION_ENABLE:
          console.log('motion enabled ack', ack);
          ipcMain.emit('motion-enabled-ack', ack);
          if (!ack) {
            notificationSender.sendError(
              'Failed to enable motion, check machine conditions',
            );
          }
          break;
        case WriteType.TEST_RUN:
          // Test is running
          ipcMain.emit('test-run-ack', ack);
          if (ack) {
            notificationSender.sendSuccess('Test is now running');
          } else {
            notificationSender.sendError(
              'Failed to start test, make sure motion is enabled',
            );
          }
          break;
        case WriteType.MANUAL_MOVE:
          // Manual move queued
          if (!ack) {
            notificationSender.sendError(
              'Failed to queue manual move, make sure motion is enabled',
            );
          }
          break;
        case WriteType.TEST_MOVE:
          // Test move queued, should resend if failed
          ipcMain.emit('test-move-ack', ack);
          break;
        case WriteType.SAMPLE_PROFILE:
          // Sample profile set
          if (ack) {
            notificationSender.sendSuccess('Test is setup');
          } else {
            notificationSender.sendError('Test setup failed');
          }
          break;
        default:
      }
    });

    // Handle incomming data
    dataProcessor.on('data', (command: ReadType, data: string) => {
      this.device_connected = true;
      let dataJSON;
      try {
        dataJSON = JSON.parse(data);
      } catch (err) {
        console.log('failed to parse data', err);
        return;
      }
      switch (command) {
        case ReadType.SAMPLE:
          //console.log("Sample Data: ", data);
          this.last_sample_data_ms = Date.now();
          let sampleData = dataJSON as SampleData;
          this.sample_data_buffer.push(dataJSON as SampleData);
          if (this.sample_data_buffer.length > 100) {
            this.sample_data_buffer.shift();
          }
          this.window.webContents.send(
            'sample-data-updated',
            this.sample_data_buffer[this.sample_data_buffer.length - 1],
          );
          break;
        case ReadType.STATE:
          this.machine_state = dataJSON as MachineState;
          //console.log("machine state: ", this.machine_state);
          this.window.webContents.send(
            'machine-state-updated',
            this.machine_state,
          );
          break;
        case ReadType.MACHINE_CONFIGURATION:
          this.machine_configuration = dataJSON as MachineConfiguration;
          console.log("Machine Configuration", this.machine_configuration);
          ipcMain.emit(
            'machine-configuration-updated',
            this.machine_configuration,
          );
          break;
        default:
      }
    });

    // Handle notifications
    dataProcessor.on('notification', (notification: Notification) => {
      this.device_connected = true;
      switch (notification.Type) {
        case NotificationType.ERROR:
          notificationSender.sendError(notification.Message);
          break;
        case NotificationType.WARN:
          notificationSender.sendWarning(notification.Message);
          break;
        case NotificationType.INFO:
          notificationSender.sendInfo(notification.Message);
          break;
        case NotificationType.SUCCESS:
          notificationSender.sendSuccess(notification.Message);
          break;
        default:
          console.log('message type unknown');
      }
    });
  }
}

export default DeviceInterface;
