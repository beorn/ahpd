// 34599: another process's view of a seat's custody lock. Prints "held" when some other owner holds it.
import { tryAcquireFlock } from '@bearly/flock';

const handle = tryAcquireFlock(process.argv[2], { create: false });
process.stdout.write(handle === null ? 'held' : 'free');
handle?.release();
