import type { ToolImpl } from './types';

import { getPositionTool } from './impl/get_position';
import { getHealthTool } from './impl/get_health';
import { getInventoryTool } from './impl/get_inventory';
import { getEntitiesTool } from './impl/get_entities';
import { getTimeOfDayTool } from './impl/get_time_of_day';
import { searchItemsTool } from './impl/search_items';
import { gotoPositionTool } from './impl/goto_position';
import { gotoEntityTool } from './impl/goto_entity';
import { huntEntityTool } from './impl/hunt_entity';
import { eatFoodTool } from './impl/eat_food';
import { collectItemTool } from './impl/collect_item';
import { equipBestArmorTool } from './impl/equip_best_armor';
import { dropItemTool } from './impl/drop_item';
import { lookAtTool } from './impl/look_at';
import { waitTool } from './impl/wait';
import { sendChatTool } from './impl/send_chat';

/**
 * Full set of tools exposed to the LLM agent. The registry is the single
 * source of truth — everything the agent can do is listed here.
 */
export function allTools(): ToolImpl[] {
  return [
    // Read-only observation
    getPositionTool,
    getHealthTool,
    getInventoryTool,
    getEntitiesTool,
    getTimeOfDayTool,
    searchItemsTool,
    // Long-running (sustained) tools routed through AgentActionExecutor
    gotoPositionTool,
    gotoEntityTool,
    huntEntityTool,
    eatFoodTool,
    // Planner-backed collection
    collectItemTool,
    // Quick inline actions
    equipBestArmorTool,
    dropItemTool,
    lookAtTool,
    waitTool,
    sendChatTool
  ];
}
