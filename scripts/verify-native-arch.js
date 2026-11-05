// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Gate that fails the package when a native addon (.node) does not match the
// target architecture of the build. This covers the error:193 class of bugs
// (ERROR_BAD_EXE_FORMAT) where a wrong-arch .node is packed, either loose,
// unpacked (app.asar.unpacked) or embedded inside app.asar (Electron extracts
// those to %TEMP%\*.tmp.node before dlopen, which is where the runtime error
// points).

const fs = require('fs');
const path = require('path');

const MACHINE_NAMES = {
    0x14c: 'ia32',
    0x8664: 'x64',
    0xaa64: 'arm64',
};

// electron-builder Arch enum values, resolved from the live app-builder-lib
// when running inside electron-builder (ia32=0, x64=1, armv7l=2, arm64=3,
// universal=4 on electron-builder 24).
const ARCH_NAMES = (() => {
    try {
        const ebArch = require('app-builder-lib').Arch;
        if (ebArch && typeof ebArch === 'object') {
            return ebArch;
        }
    } catch (error) {
        // standalone CLI usage without electron-builder in the dependency tree
    }
    return {0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal'};
})();

function expectedMachine(arch) {
    const name = /^\d+$/.test(String(arch)) ? (ARCH_NAMES[Number(arch)] || String(arch)) : arch;
    switch (String(name).toLowerCase()) {
    case 'ia32':
        return 0x14c;
    case 'x64':
        return 0x8664;
    case 'arm64':
        return 0xaa64;
    default:
        throw new Error(`Unsupported architecture: ${arch}`);
    }
}

function peMachine(filePath) {
    const buf = Buffer.alloc(4096);
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, buf.length, 0);
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }

    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
        return 'not-pe';
    }

    const peOffset = buf.readUInt32LE(0x3c);
    if (peOffset + 6 > buf.length || buf.readUInt32LE(peOffset) !== 0x00004550) {
        return 'not-pe';
    }

    const machine = buf.readUInt16LE(peOffset + 4);
    return MACHINE_NAMES[machine] || `unknown-0x${machine.toString(16)}`;
}

// Minimal asar reader: walk the JSON header and read embedded file bytes so we
// can check .node modules that live inside the archive (they are what ends up
// as %TEMP%\*.tmp.node at runtime).
function readAsarHeader(asarPath) {
    const buf = Buffer.alloc(16);
    const fd = fs.openSync(asarPath, 'r');
    try {
        fs.readSync(fd, buf, 0, 16, 0);
        const headerSize = buf.readUInt32LE(4);
        const jsonSize = buf.readUInt32LE(12);
        const jsonBuf = Buffer.alloc(jsonSize);
        fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
        return {header: JSON.parse(jsonBuf.toString()), contentOffset: 8 + headerSize};
    } finally {
        fs.closeSync(fd);
    }
}

function readAsarFile(asarPath, meta, contentOffset) {
    const buf = Buffer.alloc(Math.min(meta.size, 4096));
    const fd = fs.openSync(asarPath, 'r');
    try {
        fs.readSync(fd, buf, 0, buf.length, contentOffset + Number(meta.offset));
    } finally {
        fs.closeSync(fd);
    }
    return buf;
}

function walkHeader(node, currentPath, results) {
    for (const [name, child] of Object.entries(node.files || {})) {
        const full = `${currentPath}/${name}`;
        if (child.files) {
            walkHeader(child, full, results);
        } else if (full.endsWith('.node')) {
            results.push({path: full, meta: child});
        }
    }
    return results;
}

function collectNodeModules(appOutDir) {
    const found = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith('.node')) {
                found.push({path: full, insideAsar: false});
            }
        }
    };
    walk(appOutDir);

    const asarPath = path.join(appOutDir, 'resources', 'app.asar');
    if (fs.existsSync(asarPath)) {
        const {header, contentOffset} = readAsarHeader(asarPath);
        const entries = walkHeader(header, '', []);
        const unpackedDir = path.join(appOutDir, 'resources', 'app.asar.unpacked');
        for (const entry of entries) {
            if (entry.meta.unpacked) {
                continue; // already covered by the disk walk above
            }
            found.push({path: entry.path, insideAsar: true, asarPath, meta: entry.meta, contentOffset});
        }
        if (!fs.existsSync(unpackedDir) && entries.length > 0) {
            throw new Error(`app.asar exists without app.asar.unpacked at ${appOutDir}`);
        }
    }

    return found;
}

function verifyNativeArch(appOutDir, arch) {
    const expected = expectedMachine(arch);
    const expectedName = MACHINE_NAMES[expected];
    const win32Dir = `win32-${expectedName}`;

    const modules = collectNodeModules(appOutDir);
    if (modules.length === 0) {
        return [];
    }

    const problems = [];
    const enforced = [];
    for (const module of modules) {
        // Multi-arch prebuilds ship one folder per platform/arch and the
        // runtime loader picks the right one. Only the folder matching this
        // build's win32 arch is loadable here; other folders are dead weight.
        const prebuildDir = module.path.match(/[\\/]prebuilds[\\/]([^\\/]+)[\\/]/);
        if (prebuildDir && prebuildDir[1] !== win32Dir) {
            continue;
        }
        enforced.push(module.path);

        let machine;
        try {
            if (module.insideAsar) {
                const buf = readAsarFile(module.asarPath, module.meta, module.contentOffset);
                machine = peMachineBuffer(buf);
            } else {
                machine = peMachine(module.path);
            }
        } catch (error) {
            problems.push(`cannot read native module: ${module.path}: ${error.message}`);
            continue;
        }

        if (machine !== expectedName) {
            problems.push(
                `${module.insideAsar ? 'inside app.asar' : 'on disk'}: ${module.path} is ${machine}, expected ${expectedName}`,
            );
        }
    }

    if (problems.length > 0) {
        problems.unshift(`Native architecture mismatch in ${appOutDir} (target ${expectedName}):`);
        throw new Error(problems.join('\n'));
    }

    return enforced;
}

function peMachineBuffer(buf) {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
        return 'not-pe';
    }
    const peOffset = buf.readUInt32LE(0x3c);
    if (peOffset + 6 > buf.length || buf.readUInt32LE(peOffset) !== 0x00004550) {
        return 'not-pe';
    }
    return MACHINE_NAMES[buf.readUInt16LE(peOffset + 4)] || 'unknown';
}

module.exports = {verifyNativeArch, expectedMachine, peMachine, readAsarHeader};

// CLI for local verification: node scripts/verify-native-arch.js <appOutDir> <arch>
if (require.main === module) {
    const [dir, arch] = process.argv.slice(2);
    try {
        verifyNativeArch(dir, arch);
        console.log(`OK: every .node in ${dir} matches ${ARCH_NAMES[arch] || arch}`);
    } catch (error) {
        console.error(error.message);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    }
}
