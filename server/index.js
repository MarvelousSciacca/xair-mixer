import os from 'node:os';
import { startBridge } from './bridge.js';
import { startSimulator } from './simulator.js';

const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--port='));

if (args.includes('--sim-lan')) {
  // Simulatore raggiungibile dagli altri dispositivi della rete (per provare l'app Android a casa).
  const lan = Object.values(os.networkInterfaces()).flat().find(ni => ni?.family === 'IPv4' && !ni.internal);
  startSimulator({ host: lan?.address ?? '127.0.0.1', bind: '0.0.0.0' });
} else if (args.includes('--sim')) {
  startSimulator();
}
startBridge({ port: portArg ? Number(portArg.split('=')[1]) : Number(process.env.PORT ?? 8080) });
