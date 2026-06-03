---
title: FreeRTOS v11.3.0 LTS 移植指南 — STM32F103C8 (Blue Pill)
description: FreeRTOS 移植到 STM32F103C8 (Blue Pill) 的完整指南，涵盖 FreeRTOSConfig 配置、platformio.ini、中断映射、任务拆分等
publishDate: 2025-01-15
tags:
  - FreeRTOS
  - STM32
  - embedded
---

# FreeRTOS v11.3.0 LTS 移植指南 — STM32F103C8 (Blue Pill)

> 项目：TCS 充电管理系统
> 硬件：Blue Pill (STM32F103C8) — ARM Cortex-M3, 64KB Flash, 20KB RAM
> 工具链：PlatformIO + GCC (arm-none-eabi)

---

## 步骤一：创建 `FreeRTOSConfig.h`

在 `include/` 目录下新建 `FreeRTOSConfig.h`。

关键配置项：

| 宏 | 建议值 | 说明 |
|---|---|---|
| `configCPU_CLOCK_HZ` | 根据实际系统时钟 | 确认 `sys.h` 或 `system_stm32f10x.c` 中的时钟配置 |
| `configTOTAL_HEAP_SIZE` | `(12 * 1024)` | STM32F103C8 仅 20KB RAM，留空间给全局变量和任务栈 |
| `configSUPPORT_DYNAMIC_ALLOCATION` | `1` | 使用 heap_4，支持动态创建任务/队列 |
| `configKERNEL_INTERRUPT_PRIORITY` | `255` | 最低优先级，Cortex-M3 4 位优先级 |
| `configMAX_SYSCALL_INTERRUPT_PRIORITY` | `191` | 可安全调用 FreeRTOS API 的最高中断优先级 |

同时添加三个中断函数别名宏，将 FreeRTOS port 层函数映射到启动文件中的中断处理函数：

```c
#define vPortSVCHandler     SVC_Handler
#define xPortPendSVHandler  PendSV_Handler
#define xPortSysTickHandler SysTick_Handler
```

---

## 步骤二：更新 `platformio.ini`

添加 FreeRTOS 的头文件路径和源文件编译项。

```ini
build_flags =
    # 原有路径保留
    -Isrc
    -Isrc/ADC
    -Isrc/CHARGE
    -Isrc/CENTRE
    -Isrc/DS18B20
    -Isrc/JUDGE
    -Isrc/LED
    -Isrc/PWM
    -Iinclude
    -Ilib/STM32F10x_SPL
    -DSTM32F10X_MD
    -DUSE_STDPERIPH_DRIVER
    # 新增 FreeRTOS 头文件路径
    -IFreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/include
    -IFreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/portable/GCC/ARM_CM3

src_filter =
    +<src/*.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/tasks.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/queue.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/timers.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/list.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/event_groups.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/stream_buffer.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/portable/GCC/ARM_CM3/port.c>
    +<FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/portable/MemMang/heap_4.c>
```

---

## 步骤三：中断向量映射

FreeRTOS ARM_CM3 port 定义了三个函数，需要挂到中断向量表上：

| FreeRTOS 函数 | 对应中断处理函数 |
|---|---|
| `vPortSVCHandler` | `SVC_Handler` |
| `xPortPendSVHandler` | `PendSV_Handler` |
| `xPortSysTickHandler` | `SysTick_Handler` |

已在步骤一中通过宏定义完成别名映射。

**注意**：确认 `delay.c` 中是否实现了自己的 `SysTick_Handler`。如果是，有两种方案：

1. **FreeRTOS 接管 SysTick**：删除或注释掉原来的 `SysTick_Handler`，代码中改用 `vTaskDelay()` 替代 `delay_ms()`
2. **保留自定义 SysTick**：另找一个定时器（如 TIM2）专门给 FreeRTOS，通过 `configSYSTICK_CLOCK_HZ` 和 port 层配置切换

---

## 步骤四：改造 `main.c`

将裸机超级循环拆分为 FreeRTOS 多任务结构。

### 流程

```c
#include "FreeRTOS.h"
#include "task.h"

void TaskCharge(void *pvParameters) {
    while (1) {
        // 原充电管理逻辑
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void TaskLED(void *pvParameters) {
    while (1) {
        // LED 指示逻辑
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}

void TaskTemp(void *pvParameters) {
    while (1) {
        // DS18B20 温度检测
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

int main(void) {
    // 硬件初始化（保留原有）
    delay_init();
    uart_init(115200);
    LED_Init();
    // ... 其余初始化

    // 创建任务
    xTaskCreate(TaskCharge, "Charge", 256, NULL, 1, NULL);
    xTaskCreate(TaskLED,    "LED",    128, NULL, 2, NULL);
    xTaskCreate(TaskTemp,   "Temp",   128, NULL, 1, NULL);

    // 启动调度器
    vTaskStartScheduler();

    // 不会执行到这里
    while (1);
}
```

### 任务拆分建议

| 任务 | 功能 | 优先级 | 栈大小 (words) | 周期 |
|---|---|---|---|---|
| Charge | 充电控制、过流/过温保护 | 2 (最高) | 256 | 100ms |
| LED | LED 状态指示 | 1 | 128 | 250ms |
| Temp | DS18B20 温度采样 | 1 | 128 | 1s |
| Display | 显示屏刷新 (如有) | 1 | 128 | 200ms |

---

## 步骤五：钩子函数（可选）

若在 `FreeRTOSConfig.h` 中启用了以下宏，需提供对应实现：

```c
void vApplicationIdleHook(void);
void vApplicationTickHook(void);
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName);
void vApplicationMallocFailedHook(void);
```

推荐至少实现 `vApplicationStackOverflowHook` 用于调试。

---

## 注意事项

| 问题 | 说明 |
|---|---|
| **RAM 紧张** | 仅 20KB RAM，每任务栈不要过大。默认 128~256 words 起步，用 `uxTaskGetStackHighWaterMark()` 监控用量 |
| **`delay_ms()`** | 原 `delay.c` 若使用 SysTick 阻塞延时，需改为 `vTaskDelay()` 或 `vTaskDelayUntil()`，否则调度器无法切换任务 |
| **NVIC 优先级分组** | 必须设为 4 位抢占优先级（`NVIC_PriorityGroup_4`），否则 FreeRTOS 临界区可能失效。在 `main()` 最前面调用 `NVIC_PriorityGroupConfig(NVIC_PriorityGroup_4)` |
| **configASSERT** | 调试期间强烈建议开启，用于捕获栈溢出、参数错误等问题 |
| **中断中调用 FreeRTOS API** | 必须使用 `FromISR` 后缀的 API（如 `xQueueSendFromISR`），不要用普通版本 |
| **Flash 64KB** | FreeRTOS 内核 + 你原有代码可能接近极限。如果编译超限，裁剪不需要的 FreeRTOS 功能（如 `configUSE_TIMERS`、`configUSE_CO_ROUTINES` 等） |

---

## 调试建议

1. 前三步做好后先**尝试编译**，确认 FreeRTOS 能编译通过
2. 写一个空的 `main()`（只创建一个任务 + 启动调度器），验证能否运行
3. 逐步把原 `while(1)` 中的逻辑拆进独立任务，一次迁移一个功能模块
4. 用 `vTaskDelay()` 替代所有 `delay_ms()`，用 `xSemaphore` 或 `xQueue` 做任务间通信

---

## 参考文件路径

```
include/
  └── FreeRTOSConfig.h                      ← 新建

FreeRTOS-LTS/FreeRTOS/FreeRTOS-Kernel/
  ├── tasks.c
  ├── queue.c
  ├── timers.c
  ├── list.c
  ├── event_groups.c
  ├── stream_buffer.c
  ├── include/                              ← 已存在
  └── portable/
      ├── GCC/ARM_CM3/port.c               ← Cortex-M3 移植层
      └── MemMang/heap_4.c                 ← 动态内存分配
```
