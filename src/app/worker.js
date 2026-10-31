// Generation off the main thread. Same generator, same result: the worker only
// moves the work, it never changes the course.
import { generateCourse } from '../generator/index.js';

self.onmessage = (event) => {
  const { id, recipe, seed } = event.data;
  self.postMessage({ id, result: generateCourse(recipe, seed) });
};
