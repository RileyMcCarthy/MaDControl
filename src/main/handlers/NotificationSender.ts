import { BrowserWindow } from 'electron';

class NotificationSender {
  private window: BrowserWindow;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  sendError(notification: string) {
    console.log('Error:', notification);
    this.window.webContents.send('notification-error', notification);
  }

  sendWarning(notification: string) {
    console.log('Warning:', notification);
    this.window.webContents.send('notification-warning', notification);
  }

  sendInfo(notification: string) {
    console.log('Info:', notification);
    this.window.webContents.send('notification-info', notification);
  }

  sendSuccess(notification: string) {
    console.log('Success:', notification);
    this.window.webContents.send('notification-success', notification);
  }
}

export default NotificationSender;
