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
import { app } from '@getcronit/pylon'
import { serveStatic } from "hono/bun";

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

// Serve static files from the './public' directory
app.use('/*', serveStatic({ root: './client/dist' }));

export default app;
