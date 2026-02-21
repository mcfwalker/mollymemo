import { processItem } from "./process-item";
import { discoverContent } from "./discover";
import { mergeContainers } from "./merge-containers";

// Export all Inngest functions for the serve handler
export const functions = [processItem, discoverContent, mergeContainers];
