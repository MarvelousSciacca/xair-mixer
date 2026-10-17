import { startBridge } from './bridge.js';
import { startSimulator } from './simulator.js';

const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--port='));

if (args.includes('--sim')) startSimulator();
startBridge({ port: portArg ? Number(portArg.split('=')[1]) : Number(process.env.PORT ?? 8080) });
