---
name: Fiscal Clarity
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#464555'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#006c4a'
  on-secondary: '#ffffff'
  secondary-container: '#82f5c1'
  on-secondary-container: '#00714e'
  tertiary: '#950029'
  on-tertiary: '#ffffff'
  tertiary-container: '#c20038'
  on-tertiary-container: '#ffd0d2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#85f8c4'
  secondary-fixed-dim: '#68dba9'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#ffdada'
  tertiary-fixed-dim: '#ffb3b6'
  on-tertiary-fixed: '#40000c'
  on-tertiary-fixed-variant: '#920028'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style

The design system is engineered for a personal finance context where clarity, precision, and trust are paramount. It follows a **Modern Corporate** aesthetic with a heavy emphasis on **Minimalism**. The interface utilizes generous whitespace to reduce cognitive load when viewing complex financial data.

The emotional response should be one of "controlled transparency"—the user should feel organized and in command of their data. Visual elements are restrained, avoiding unnecessary decoration to ensure that the user's financial trends and balances remain the focal point. Surfaces are clean, using a light-mode primary palette to maintain a fresh, professional atmosphere.

## Colors

The color palette is functional and semantic, designed to provide immediate context to financial movements.

- **Primary (Indigo 600):** Used for primary actions, active states, and branding elements. It represents stability and professional intent.
- **Success/Income (Emerald 600):** Reserved for positive financial indicators, growth, and income entries.
- **Error/Expense (Rose 600):** Used for negative balances, debt, expenses, and critical alerts.
- **Neutral/Text (Slate 900):** Provides high-contrast readability for all data points.
- **Background (Slate 50):** A soft, cool-toned base that reduces screen glare compared to pure white.
- **Surface (White):** Used for cards and containers to create a distinct layer of information over the background.

## Typography

The typography system relies exclusively on **Inter**, chosen for its exceptional legibility in data-heavy environments and its robust support for the Cyrillic alphabet.

- **Numerical Data:** For financial figures, use tabular lining figures to ensure decimal points and currency symbols align vertically in lists and tables.
- **Hierarchy:** Use `label-caps` for table headers and section overviews. Use `display-lg` specifically for total balance views.
- **Localization:** Ensure line-heights remain generous for Russian text, as Cyrillic characters can often appear denser than Latin counterparts.

## Layout & Spacing

This design system uses a **Fixed Grid** model for desktop and a **Fluid Grid** for mobile devices.

- **Desktop Layout:** 12-column grid with a max-width of 1280px. Columns are separated by 24px gutters. Content should be centered with 40px minimum side margins.
- **Mobile Layout:** 4-column fluid grid with 16px margins and 16px gutters.
- **Spacing Rhythm:** All spacing must be a multiple of 4px. Use `md` (16px) for internal card padding and `lg` (24px) for spacing between major sections or cards.
- **Alignment:** Financial amounts in tables should be right-aligned to allow for easy visual comparison of magnitude.

## Elevation & Depth

The system uses **Tonal Layers** combined with **Ambient Shadows** to create a structured sense of depth without overwhelming the user with heavy gradients.

- **Level 0 (Background):** Slate 50. Flat.
- **Level 1 (Cards/Containers):** White background. Shadow: `0px 1px 3px rgba(15, 23, 42, 0.08)`. This is the primary work surface.
- **Level 2 (Modals/Popovers):** White background. Shadow: `0px 10px 15px -3px rgba(15, 23, 42, 0.12)`.
- **Interactions:** On hover, Level 1 cards should transition to a slightly deeper shadow: `0px 4px 6px -1px rgba(15, 23, 42, 0.1)`. Avoid using shadows on buttons; use solid color fills and subtle borders instead.

## Shapes

The shape language is modern and approachable.

- **Primary Radius:** Use 8px (`rounded`) for most UI components including buttons, input fields, and small cards.
- **Container Radius:** Large dashboard containers and main content cards should use 12px (`rounded-lg`) to create a softer, more premium feel.
- **Icon Enclosures:** Small status indicators (e.g., category icons) use 100% (pill/circle) for distinct identification.

## Components

- **Buttons:** Primary buttons use Indigo 600 with white text. Ghost buttons use a Slate 200 border and Slate 900 text. All buttons have an 8px radius and a height of 40px or 48px.
- **Cards:** The fundamental building block. Must have a white background, 12px radius, and a subtle Level 1 shadow. Title should be `headline-sm`.
- **Input Fields:** 8px radius, Slate 200 border, and 16px horizontal padding. On focus, the border changes to Indigo 600 with a 2px outer glow.
- **Chips/Badges:** For transaction categories. Use a subtle tinted background (e.g., 10% opacity of the category color) with high-contrast text. 100px radius (pill).
- **Lists:** Transaction lists should use 16px vertical padding. Include a "leading" icon for the category and a "trailing" value for the amount. Positive values (income) use Emerald 600; negative values (expenses) use Slate 900 (standard) or Rose 600 (alerts).
- **Data Visualization:** Charts should use a 2px stroke width. Primary trend lines should be Indigo 600. Fill areas under lines should use a 10% opacity gradient of the line color.
