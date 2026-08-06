import { Header, Footer } from "./layout.js";

export const orderConfirmation = (user, order) => {
    console.log("Generating order confirmation email for order:", order);

    // 1. Correctly map and stringify table rows for items
    const orderItems = order.items.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size: 14px; color: #333;">
              <strong>${item.product_name}</strong>
              ${item.variant_name ? `<br/><span style="color:#777;">${item.variant_name}</span>` : ""}
            </td>

            <td align="center" style="font-size: 14px; color: #555;">
              x${item.quantity}
            </td>

            <td align="right" style="font-size: 14px; color: #111; font-weight: 600;">
              ₦${Number(item.subtotal).toLocaleString()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join("");

    // 2. Wrap the core email template correctly in a single return string statement
    return `
    ${Header()}
    <tr>
      <td style="padding: 20px 30px 0 30px; text-align: center;">
        <h2 style="margin: 0; font-weight: 600; color: #222;">
          Order Confirmed 🎉
        </h2>
      </td>
    </tr>

    <tr>
      <td style="padding: 20px 30px;">

        <p style="text-align: center; margin-bottom: 20px;">
          <img src="" height="100" alt="Order Confirmed" />
        </p>

        <p style="text-align: center; font-size: 15px; line-height: 1.6; color: #555;">
          Hi <strong>${user.firstname}</strong>,
          <br />
          Thank you for shopping with us.
          <br />
          Your order has been received and is now being processed.
        </p>

        <div style="
          background: #f8f9fa;
          padding: 16px;
          border-radius: 8px;
          margin: 25px 0;
        ">
          <p style="margin: 0 0 8px 0; color: #333;">
            <strong>Order ID:</strong> #${order.order_number}
          </p>

          <p style="margin: 0 0 8px 0; color: #333;">
            <strong>Payment Status:</strong> ${order.payment_status}
          </p>

          <p style="margin: 0; color: #333;">
            <strong>Order Date:</strong>
            ${new Date(order.created_at).toLocaleString()}
          </p>
        </div>

        <h3 style="margin-bottom: 15px; color: #222;">
          Order Summary
        </h3>

        <table width="100%" cellpadding="0" cellspacing="0">
          ${orderItems}
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
          <tr>
            <td style="padding: 6px 0; color: #555;">
              Subtotal
            </td>

            <td align="right" style="padding: 6px 0; color: #111;">
              ₦${Number(order.subtotal).toLocaleString()}
            </td>
          </tr>

          <tr>
            <td style="padding: 6px 0; color: #555;">
              Shipping
            </td>

            <td align="right" style="padding: 6px 0; color: #111;">
              ₦${Number(order.shipping_fee).toLocaleString()}
            </td>
          </tr>

          ${Number(order.discount || 0) > 0
            ? `
                <tr>
                  <td style="padding: 6px 0; color: #555;">
                    Discount
                  </td>

                  <td align="right" style="padding: 6px 0; color: #28a745;">
                    - ₦${Number(order.discount).toLocaleString()}
                  </td>
                </tr>
              `
            : ""
          }

          <tr>
            <td style="
              padding-top: 14px;
              font-size: 16px;
              font-weight: 700;
              color: #111;
            ">
              Total
            </td>

            <td align="right" style="
              padding-top: 14px;
              font-size: 16px;
              font-weight: 700;
              color: #111;
            ">
              ₦${Number(order.total).toLocaleString()}
            </td>
          </tr>
        </table>

        <p style="text-align: center; margin-top: 30px;">
          <a href="https://tetyhub.com{order.id}"
             style="
               display: inline-block;
               padding: 12px 30px;
               background-color: #28a745;
               color: #fff;
               text-decoration: none;
               border-radius: 5px;
               font-size: 15px;
               font-weight: 600;
             ">
            Track Order
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="text-align: center; font-size: 13px; color: #999;">
          If you have any questions regarding your order,
          feel free to contact our support team.
        </p>

      </td>
    </tr>
    ${Footer()}
  `;
};
