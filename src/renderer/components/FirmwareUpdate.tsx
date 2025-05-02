import React, { useState, useEffect } from 'react';
import {
  Button,
  Box,
  Typography,
  LinearProgress,
  Paper,
} from '@mui/material';
import { styled } from '@mui/material/styles';

const { ipcRenderer } = window.electron;

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  marginBottom: theme.spacing(3),
  marginTop: theme.spacing(3),
}));

const LogContainer = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.grey[900],
  color: theme.palette.common.white,
  fontFamily: 'monospace',
  padding: theme.spacing(2),
  borderRadius: theme.shape.borderRadius,
  height: '250px',
  overflow: 'auto',
  marginTop: theme.spacing(2),
}));

function FirmwareUpdate() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);

  useEffect(() => {
    const loadVersions = async () => {
      try {
        const currentVer = await ipcRenderer.invoke('get-firmware-version');
        setCurrentVersion(currentVer);

        const latestVer = await ipcRenderer.invoke(
          'get-latest-firmware-version',
        );
        setLatestVersion(latestVer);
      } catch (error) {
        console.error('Error loading firmware versions:', error);
      }
    };

    loadVersions();

    // Listen for firmware update progress messages
    const updateProgressHandler = (...args: unknown[]) => {
      const message = args[0] as string;
      setUpdateLogs((prevLogs) => [...prevLogs, message]);
      // Scroll to bottom of log container
      const logContainer = document.getElementById('firmware-log-container');
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    };

    const updateErrorHandler = (...args: unknown[]) => {
      const message = args[0] as string;
      setUpdateLogs((prevLogs) => [...prevLogs, `ERROR: ${message}`]);
    };

    const removeProgressListener = ipcRenderer.on(
      'firmware-update-progress',
      updateProgressHandler,
    );
    const removeErrorListener = ipcRenderer.on(
      'firmware-update-error',
      updateErrorHandler,
    );

    return () => {
      removeProgressListener();
      removeErrorListener();
    };
  }, []);

  const handleFirmwareUpdate = async () => {
    setUpdateInProgress(true);
    setUpdateLogs([]);
    try {
      setUpdateLogs([`Downloading latest firmware from GitHub repository...`]);
      // Call the update-firmware handler with no parameters
      const result = await ipcRenderer.invoke('update-firmware');
      if (result.success) {
        setUpdateLogs((prevLogs) => [
          ...prevLogs,
          'Firmware update completed successfully!',
        ]);
        // Refresh the current version after successful update
        const currentVer = await ipcRenderer.invoke('get-firmware-version');
        setCurrentVersion(currentVer);
      } else {
        setUpdateLogs((prevLogs) => [
          ...prevLogs,
          `Firmware update failed: ${result.error}`,
        ]);
      }
    } catch (error) {
      console.error('Error updating firmware:', error);
      setUpdateLogs((prevLogs) => [
        ...prevLogs,
        `Error updating firmware: ${error}`,
      ]);
    } finally {
      setUpdateInProgress(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Firmware Update
      </Typography>

      <StyledPaper elevation={3}>
        <Typography variant="subtitle1">
          Current Firmware: {currentVersion || 'Unknown'}
        </Typography>
        <Typography variant="subtitle1">
          Latest Available: {latestVersion || 'Checking...'}
        </Typography>

        <Box sx={{ mt: 3 }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleFirmwareUpdate}
            disabled={updateInProgress}
          >
            Download & Flash Latest Release
          </Button>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            Downloads latest firmware from GitHub and flashes using FlexProp toolchain
          </Typography>
        </Box>
      </StyledPaper>

      <StyledPaper elevation={3}>
        <Typography variant="h6" gutterBottom>
          Update Progress
        </Typography>
        {updateInProgress && (
          <Box sx={{ width: '100%', mb: 2 }}>
            <LinearProgress />
          </Box>
        )}
        <LogContainer id="firmware-log-container">
          {updateLogs.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'grey.500' }}>
              Logs will appear here when updating firmware...
            </Typography>
          ) : (
            updateLogs.map((log, index) => (
              <Typography
                key={`log-${index}`}
                variant="body2"
                gutterBottom
              >
                {log}
              </Typography>
            ))
          )}
        </LogContainer>
      </StyledPaper>
    </Box>
  );
}

export default FirmwareUpdate;
