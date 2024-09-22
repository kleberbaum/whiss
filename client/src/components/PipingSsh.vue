<template>
  <v-container v-if="!canceled && connectionState === 'connecting'">
    <v-row>
      <v-col style="text-align: center">
        <v-progress-circular indeterminate color="secondary" :size="200" :width="2" style="margin-top: 3rem;">
          Connecting...
        </v-progress-circular>

        <v-textarea label="server-host command" v-model="serverHostCommand" variant="outlined" rows="2" class="text-grey" style="margin-top: 5rem;">
          <template v-slot:append-inner>
            <CopyToClipboardButton :text="serverHostCommand"/>
          </template>
        </v-textarea>
      </v-col>
    </v-row>
  </v-container>
  <div ref="terminal" v-show="connectionState === 'connected'" style="width: 100%; height: calc(100% - 15px);"></div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import 'xterm/css/xterm.css';
import urlJoin from "url-join";
import * as Comlink from 'comlink';
import { mdiCheck, mdiKey, mdiCancel } from "@mdi/js";
import { FitAddon } from 'xterm-addon-fit';
import type { AuthKeySetForSsh } from "@/go-wasm-exported-promise";
import { ServerHostKeyManager } from "@/ServerHostKeyManager";
import { AuthKeySet, storedAuthKeySets } from "@/authKeySets";
import { aliveGoWasmWorkerRemotePromise, getAuthPublicKeyType, sshPrivateKeyIsEncrypted } from "@/go-wasm-using-worker";
import { fragmentParams } from "@/fragment-params";
import CopyToClipboardButton from "@/components/CopyToClipboardButton.vue";
import { getServerHostCommand } from "@/getServerHostCommand";
import { showPrompt } from "@/components/Globals/prompt/global-prompt";
import { showSnackbar } from "@/components/Globals/snackbar/global-snackbar";

const props = defineProps({
  pipingServerUrl: String,
  pipingServerHeaders: Array,
  csPath: String,
  scPath: String,
  username: String,
  defaultSshPassword: String,
});

const emit = defineEmits(['end']);

const xtermPromise = () => import("xterm");

const connectionState = ref("connecting");

const terminal = ref(null);
const serverHostKeyManager = new ServerHostKeyManager();

const canceled = ref(false);

const serverHostCommand = ref(getServerHostCommand({
  pipingServerUrl: props.pipingServerUrl,
  pipingServerHeaders: props.pipingServerHeaders,
  csPath: props.csPath,
  scPath: props.scPath,
  sshServerPort: fragmentParams.sshServerPortForHint() ?? 22,
}));

// WebSocketStream Adapter
function WebSocketStream(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer'; // Ensures binary data

  // Create ReadableStream for WebSocket data
  const readable = new ReadableStream({
    start(controller) {
      ws.onmessage = (event) => {
        controller.enqueue(new Uint8Array(event.data)); // Pass binary data as Uint8Array
      };
      ws.onclose = () => {
        controller.close(); // Close readable stream when WebSocket closes
      };
      ws.onerror = (error) => {
        controller.error(error); // Handle WebSocket errors
      };
    }
  });

  // Create WritableStream for WebSocket
  const writable = new WritableStream({
    write(chunk) {
      ws.send(chunk); // Send data via WebSocket
    },
    close() {
      ws.close(); // Close WebSocket when writable stream is closed
    },
    abort(reason) {
      ws.close(); // Close WebSocket in case of an abort
    }
  });

  return { readable, writable };
}

// Create transport stream
async function createTransport(useWebSocket) {
  let transport;

  if (useWebSocket) {
    const wsUrl = `${props.pipingServerUrl}/${props.csPath}:${props.scPath}`; // Change this URL as needed
    const { readable, writable } = WebSocketStream(wsUrl);

    transport = {
      wsUrl: wsUrl,
      readable: readable,
      writable: writable,
    };
  } else {
    const { readable: sendReadable, writable: sendWritable } = new TransformStream();
    const csUrl = urlJoin(props.pipingServerUrl, props.csPath);
    const scUrl = urlJoin(props.pipingServerUrl, props.scPath);
    const pipingServerHeaders = new Headers(props.pipingServerHeaders);

    // Post request for connection
    fetch(csUrl, {
      method: "POST",
      headers: pipingServerHeaders,
      body: sendReadable,
      duplex: 'half',
    } as any).then(postRes => {
      console.log("postRes", postRes);
    });

    const getRes = await fetch(scUrl, {
      headers: pipingServerHeaders,
    });

    transport = {
      readable: getRes.body!,
      writable: sendWritable,
    };
  }

  return transport;
}

async function getAuthKeySetsForSsh() {
  const notSorted = await Promise.all(storedAuthKeySets.value
    .filter(s => s.enabled)
    .map(async s => {
      const encrypted = await sshPrivateKeyIsEncrypted(s.privateKey);
      const set = {
        publicKey: s.publicKey,
        privateKey: s.privateKey,
        encrypted,
      };
      return set;
    })
  );
  return [
    ...notSorted.filter(a => !a.encrypted),
    ...notSorted.filter(a => a.encrypted),
  ];
}

function findAuthKeySetByFingerprint(sha256Fingerprint) {
  return storedAuthKeySets.value.find(s => s.sha256Fingerprint === sha256Fingerprint);
}

async function getAuthPrivateKeyPassphrase(sha256Fingerprint) {
  const authKeySetForSsh = findAuthKeySetByFingerprint(sha256Fingerprint);
  const keyType = await getAuthPublicKeyType(authKeySetForSsh.publicKey);
  const passphrase = await showPrompt({
    title: "Passphrase",
    message: `(${authKeySetForSsh.name}) ${keyType}\nEnter passphrase for key`,
    inputType: "password",
    width: "60vw",
  });
  if (passphrase === undefined) {
    canceled.value = true;
    throw new Error("passphrase input canceled");
  }
  return passphrase;
}

onMounted(async () => {
  await start();
});

async function start() {
  const { Terminal } = await xtermPromise();
  const term = new Terminal({ cursorBlink: true });
  const fitAddon = new FitAddon();
  const messageChannel = new MessageChannel();
  term.loadAddon(fitAddon);
  term.open(terminal.value);
  window.addEventListener('resize', () => {
    fitTerminal();
  });

  async function fitTerminal() {
    const proposedDims = fitAddon.proposeDimensions();
    if (proposedDims === undefined) {
      return;
    }
    messageChannel.port1.postMessage({
      type: "resize",
      cols: proposedDims.cols,
      rows: proposedDims.rows,
    });
    fitAddon.fit();
  }

  const transport = await createTransport(/* pass true for websocket, false for http */ true);

  const originalTermWrite = term.write;
  term.write = (...args) => {
    originalTermWrite.apply(term, args);
    term.write = originalTermWrite;
    term.focus();
    fitTerminal();
    fitTerminal();
    fitTerminal();
    fitTerminal();
  };

  const termReadable = new ReadableStream({
    start(ctrl) {
      term.onData((data) => {
        ctrl.enqueue(data);
      });
    },
  });

  window.addEventListener("beforeunload", () => {
    messageChannel.port1.postMessage({
      type: "disconnect",
    });
  });

  try {
    let passwordTried = false;
    const transfers = [
      transport.readable,
      transport.writable,
      termReadable,
      messageChannel.port2
    ];

    await (await aliveGoWasmWorkerRemotePromise()).doSsh(Comlink.transfer({
      transport,
      termReadable,
      initialRows: term.rows,
      initialCols: term.cols,
      username: props.username,
      messagePort: messageChannel.port2,
      authKeySets: await getAuthKeySetsForSsh(),
    }, transfers), Comlink.proxy({
      termWrite(data) {
        term.write(data);
      },
      async onPasswordAuth() {
        if (!passwordTried && props.defaultSshPassword !== undefined) {
          passwordTried = true;
          return props.defaultSshPassword;
        }
        const password = await showPrompt({
          title: "Password",
          inputType: "password",
          width: "60vw",
        });
        if (password === undefined) {
          canceled.value = true;
          throw new Error("user aborted password input");
        }
        passwordTried = true;
        return password;
      },
      getAuthPrivateKeyPassphrase,
      onAuthSigned(sha256Fingerprint) {
        const authKeySetForSsh = findAuthKeySetByFingerprint(sha256Fingerprint);
        showSnackbar({
          icon: mdiKey,
          message: `Signed by ${authKeySetForSsh.name}`,
        });
      },
      async onHostKey({ key }) {
        if (serverHostKeyManager.isTrusted(key.fingerprint)) {
          return true;
        }
        const answer = await showPrompt({
          title: "New host",
          message: `${key.type} key fingerprint is ${key.fingerprint}\nAre you sure you want to continue connecting?`,
          placeholder: "yes/no/[fingerprint]",
          width: "60vw",
        });
        if (answer === "yes" || answer === key.fingerprint) {
          serverHostKeyManager.trust(key.fingerprint);
          return true;
        }
        canceled.value = true;
        return false;
      },
      onConnected() {
        connectionState.value = "connected";
      },
    }));

    showSnackbar({
      icon: mdiCheck,
      message: "Finished",
    });
    emit('end');
  } catch (e) {
    if (canceled.value) {
      showSnackbar({
        icon: mdiCancel,
        message: "Canceled",
      });
      emit('end');
      return;
    }
    // TODO: better handling
    console.error("SSH error", e);
    alert(`SSH error: ${e}`);
    emit('end');
  }
}
</script>
