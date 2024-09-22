/**
 * @license
 *
 * SPDX-FileType: SOURCE
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: Copyright (c) 2024 Florian Kleber
 *
 * Use of this source code is governed by an MIT license that can be found
 * in the LICENSE file at https://github.com/kleberbaum/whiss/blob/main/LICENSES/preferred/EUPL-1.2
 */
import { createBunWebSocket, serveStatic } from "hono/bun";
import { WSContext } from "hono/ws";
import type { TCPSocket } from "bun";
import { app } from '@getcronit/pylon';

export const graphql = {
  Query: {
    sum: (a: number, b: number) => {
      console.log(`Calculating sum of ${a} and ${b}`)
      return a + b
    }
  },
  Mutation: {
    divide: (a: number, b: number) => {
      if (b === 0) {
        console.error('Attempt to divide by zero')
        throw new Error('Division by zero is not allowed')
      }
      console.log(`Dividing ${a} by ${b}`)
      return a / b
    }
  }
}

const VALID_HOSTNAME_REGEX = /^[a-zA-Z0-9.-]+$/; // Basic hostname validation

const { upgradeWebSocket, websocket } = createBunWebSocket();

app.get(
  "/:sshServer",
  upgradeWebSocket((c) => {
    let sshSocket: TCPSocket | null = null;

    return {
      onMessage: (message: MessageEvent, ws: WSContext) => {
        if (sshSocket && message.data instanceof ArrayBuffer) {
          sshSocket.write(new Uint8Array(message.data));
        } else {
          console.error('Received non-binary data or no SSH connection');
        }
      },
      onOpen: (evt: Event, ws: WSContext) => {
        const { sshServer } = c.req.param();
        const [hostname, portStr] = sshServer.split(':');

        // Basic validation checks
        if (!hostname || !portStr) {
          console.error('Invalid SSH server address format');
          ws.close();
          return;
        }

        if (!VALID_HOSTNAME_REGEX.test(hostname)) {
          console.error(`Invalid hostname: ${hostname}`);
          ws.close();
          return;
        }

        const port = parseInt(portStr, 10);
        if (isNaN(port) || port <= 0 || port > 65535) {
          console.error(`Invalid port: ${port}`);
          ws.close();
          return;
        }

        console.log(`Connecting to SSH server ${hostname}:${port}`);
        Bun.connect({
          hostname,
          port,
          socket: {
            data(socket, data) {
              ws.send(data);
            },
            error(socket, error) {
              console.error('SSH socket error:', error.message);
              ws.close();
            },
            close() {
              console.log('SSH connection closed');
              ws.close();
            },
            open(socket) {
              console.log(`Connected to SSH server ${hostname}:${port}`);
              sshSocket = socket;
            },
          },
        }).catch(error => {
          console.error(`Failed to connect to SSH server ${hostname}:${port}:`, error);
          ws.close();
        });
      },
      onClose: () => {
        console.log("WebSocket connection closed");
        if (sshSocket) {
          sshSocket.end();
          sshSocket = null;
        }
      },
    };
  })
);

// Serve static files from the './public' directory
app.use('/*', serveStatic({ root: './client/dist' }));

// Start the server
Bun.serve({
  fetch: app.fetch,
  websocket,
  port: 3000,
  hostname: '0.0.0.0',
});

//export default app;
