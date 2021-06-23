"use strict";

const stripe = require("stripe")(process.env.STRIPE_PK);

/**
 * Given a dollar amount number, convert it to it's value in cents
 * @param number
 */
const fromDecimalToInt = (number) => parseInt(number * 100);
const getQuantity = (products, item) =>
  products.filter((product) => product.id === item.id)[0].quantity;

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-controllers)
 * to customize this controller
 */

const { sanitizeEntity } = require("strapi-utils");

module.exports = {
  /**
   * Retrieve records.
   *
   * @return {Array}
   */

  async find(ctx, next) {
    if (ctx.state.user) {
      // Go to next policy or will reach the controller's action.
      let entities = [];
      //   restrict query to current user
      ctx.query.user = ctx.state.user.id;

      if (ctx.query._q) {
        entities = await strapi.services.order.search(ctx.query);
      } else {
        entities = await strapi.services.order.find(ctx.query);
      }

      return entities.map((entity) =>
        sanitizeEntity(entity, { model: strapi.models.order })
      );
      return await next();
    }

    ctx.unauthorized(`You're not logged in!`);
  },
  /**
   * Retrieve one records.
   *
   * @return {Object}
   */
  async findOne(ctx, next) {
    if (ctx.state.user) {
      // Go to next policy or will reach the controller's action.
      //   restrict query to current user
      let query = { id: ctx.params.id, user: ctx.state.user.id };

      let entity = await strapi.services.order.findOne(query);

      return sanitizeEntity(entity, { model: strapi.models.order });

      return await next();
    }

    ctx.unauthorized(`You're not logged in!`);
  },
  async create(ctx, res) {
    const BASE_URL = ctx.request.headers.origin || "http://localhost:3000"; //So we can redirect back

    const { products } = await ctx.request.body;
    console.log("products", products);
    if (!products) {
      return res.status(400).send({ error: "Please add a products to body" });
    }

    let productsQuery = products.map((p) => {
      return p.id;
    });
    console.log(productsQuery);

    // Retrieve the real products here
    const realProducts = await strapi.services.product.find({
      id_in: productsQuery,
    });
    if (!realProducts) {
      return res.status(404).send({ error: "This product doesn't exist" });
    }
    console.log("realProducts", realProducts);
    let total = realProducts
      .reduce((a, b) => a + b.price * getQuantity(products, b), 0)
      .toFixed(2);
    console.log("total:", total);
    const { user } = ctx.state;
    console.log(user.email);
    let items = realProducts.map((p) => {
      let quantity = getQuantity(products, p);
      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: p.name,
          },
          unit_amount: fromDecimalToInt(p.price),
        },
        quantity,
      };
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: items,
      customer_email: user.email,
      mode: "payment",
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/failed`,
    });
    let status = 'unpaid'
    if (session.payment_status === "paid") {
      //Update order
      status = 'paid';
    }

    let subTotal = session.amount_total;

    console.log("status:", status, 'session:', session);
    //TODO Create Temp Order here
    const newOrder = await strapi.services.order.create({
      user: user.id,
      products: realProducts,
      total: subTotal,
      status: status,
      checkout_session: session.id,
    });

    return { id: session.id };
  },
  async confirm(ctx) {
    const { checkout_session } = ctx.request.body;
    console.log("checkout_session", checkout_session);
    const session = await stripe.checkout.sessions.retrieve(checkout_session);
    console.log("confirm verify session:", session);

    if (session.payment_status === "paid") {
      //Update order
      const newOrder = await strapi.services.order.update(
        {
          checkout_session,
        },
        {
          status: "paid",
        }
      );

      // return newOrder;
      return true
    } else {
      ctx.throw(
        400,
        "It seems like the order wasn't verified, please contact support"
      );
    }
  },
};
