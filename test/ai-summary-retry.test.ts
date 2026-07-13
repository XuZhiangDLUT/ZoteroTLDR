import assert from "node:assert/strict";
import test from "node:test";
import {
  GlobalTaskQueue,
  isTransientErrorMessage,
  RetryScheduledError,
} from "../src/modules/aiSummary";

test("empty summary results are transient errors", () => {
  assert.equal(
    isTransientErrorMessage("本地解析未返回最终摘要 (empty summary result)"),
    true,
  );
});

test("a retried task is not completed until its retry succeeds", async () => {
  const queue = new GlobalTaskQueue<{ attempts: number }>();
  const statuses: string[] = [];

  queue.setWorker(async (task) => {
    task.attempts += 1;
    if (task.attempts === 1) {
      throw new RetryScheduledError("empty summary result", 1, 2);
    }
  });
  queue.addEventListener(() => {
    statuses.push(queue.getAllTasks()[0]?.status || "none");
  });

  await queue.submit({ attempts: 0 });

  const status = queue.getStatus();
  assert.equal(status.completed, 1);
  assert.equal(status.failed, 0);
  assert.equal(queue.getAllTasks().length, 1);
  assert.equal(queue.getAllTasks()[0].status, "completed");
  assert.ok(statuses.includes("retrying"));
});
